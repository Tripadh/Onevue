/**
 * Frontend identity-profile behavior that can run without a browser or MongoDB.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const frontendRoot = path.resolve(__dirname, "..", "..", "frontend");
const state = require(path.join(frontendRoot, "services", "identity-profile-state.js"));

describe("Identity profile frontend contract", () => {
  test("save failures do not produce a success notice and drafts initialize from the server", () => {
    let editor = state.createProfileEditorState();
    editor = state.profileEditorReducer(editor, { type: "load_start" });
    assert.equal(editor.loading, true);
    editor = state.profileEditorReducer(editor, {
      type: "load_success",
      profile: { headline: "From the server", skills: [{ id: "skill_1", name: "Go" }] },
    });
    assert.equal(editor.loading, false);
    assert.equal(editor.draft.headline, "From the server");
    assert.notEqual(editor.draft, editor.profile);

    editor = state.profileEditorReducer(editor, { type: "save_start" });
    editor = state.profileEditorReducer(editor, { type: "save_error", message: "Database unavailable" });
    assert.equal(editor.notice, "");
    assert.equal(editor.saveError, "Database unavailable");
    assert.equal(editor.saving, false);
    assert.equal(editor.draft.headline, "From the server");

    editor = state.profileEditorReducer(editor, {
      type: "save_success",
      profile: { headline: "Confirmed", skills: [] },
    });
    assert.equal(editor.notice, "saved");
    assert.equal(editor.draft.headline, "Confirmed");
  });

  test("records are added and removed by stable id", () => {
    const first = { id: state.newRecordId(), name: "First" };
    const second = { id: state.newRecordId(), name: "Second" };
    assert.notEqual(first.id, second.id);
    let list = state.upsertById([], first);
    list = state.upsertById(list, second);
    list = [list[1], list[0]];
    list = state.upsertById(list, { id: first.id, name: "First renamed" });
    assert.equal(list.find((item) => item.id === first.id).name, "First renamed");
    assert.equal(list.find((item) => item.id === second.id).name, "Second");
    list = state.removeById(list, second.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, first.id);
  });

  test("update payloads drop owner ids and client-controlled verification", () => {
    const payload = state.buildUpdatePayload("creator", {
      userId: "attacker",
      ownerId: "attacker",
      _id: "profile",
      niche: "Audio",
      audienceStats: [{
        id: "aud_1",
        _id: "ignore",
        platform: "YouTube",
        metric: "followers",
        value: 10,
        source: "self_reported",
        measuredAt: "2024-01-01",
        verificationStatus: "verified",
      }],
    });
    assert.equal(payload.userId, undefined);
    assert.equal(payload.ownerId, undefined);
    assert.equal(payload.audienceStats[0].verificationStatus, undefined);
    assert.equal(payload.audienceStats[0]._id, undefined);
    assert.equal(payload.audienceStats[0].id, "aud_1");
    assert.equal(payload.niche, "Audio");

    const business = state.buildUpdatePayload("business", {
      registration: { legalName: "Northwind", status: "verified", registrationNumber: "SECRET" },
    });
    assert.equal(business.registration.status, undefined);
    assert.equal(business.registration.registrationNumber, "SECRET");

    const pending = state.buildUpdatePayload("business", {
      registration: { status: "pending" },
    });
    assert.equal(pending.registration.status, "pending");
  });

  test("dashboards no longer toast success after a swallowed save", () => {
    for (const [dir, name] of [
      ["professional", "Professional"],
      ["freelancer", "Freelancer"],
      ["creator", "Creator"],
      ["business", "Business"],
    ]) {
      const read = (suffix) => fs.readFileSync(path.join(frontendRoot, `components/dashboard/${dir}/${name}${suffix}.jsx`), "utf8");
      const dashboard = read("Dashboard");
      const identityPage = read("IdentityPage");
      const overview = read("OverviewPage");
      for (const source of [dashboard, identityPage, overview]) {
        assert.equal(source.includes(".catch(() => {})"), false);
        assert.equal(source.includes("Live on OneVue"), false);
      }
      assert.match(identityPage, new RegExp(`IdentityProfileEditor identity="${dir}"`));
      assert.match(dashboard, /window\.StudentProfilePage session=\{session\}/);
    }

    const editor = fs.readFileSync(path.join(frontendRoot, "components/dashboard/shared/IdentityProfileEditor.jsx"), "utf8");
    assert.match(editor, /Profile was not saved/);
    const accountPage = fs.readFileSync(path.join(frontendRoot, "components/dashboard/student/StudentProfilePage.jsx"), "utf8");
    assert.match(accountPage, /auth\.updateProfile/);
    assert.match(accountPage, /tone: 'error'/);

    const student = fs.readFileSync(path.join(frontendRoot, "components/dashboard/student/StudentDashboard.jsx"), "utf8");
    assert.match(student, /\/student\/profile/);
    assert.match(student, /if \(!res\.ok\)/);

    const service = fs.readFileSync(path.join(frontendRoot, "services/domain-profile.js"), "utf8");
    assert.equal(service.includes("localStorage"), false);
    assert.match(service, /getIdentityProfile/);
    assert.match(service, /updateIdentityProfile/);
    assert.equal(service.includes("c:profiles"), false);
  });

  test("section saves include only that section and keep unrelated draft edits", () => {
    const payload = state.buildSectionPayload("business", "products", {
      businessName: "Northwind",
      products: [{ id: "prod_1", name: "Atlas", description: "A lamp", url: "https://northwind.example/atlas" }],
      services: [{ id: "svc_1", name: "Install" }],
      userId: "attacker",
    });
    assert.deepEqual(Object.keys(payload), ["products"]);
    assert.equal(payload.products[0].name, "Atlas");
    assert.equal(payload.products[0].id, "prod_1");
    assert.equal(payload.userId, undefined);
    assert.equal(payload.services, undefined);
    assert.equal(payload.businessName, undefined);

    let editor = state.createProfileEditorState();
    editor = state.profileEditorReducer(editor, {
      type: "load_success",
      profile: {
        headline: "Saved headline",
        bio: "Saved bio",
        skills: [{ id: "skill_1", name: "Go", proficiency: "Advanced", yearsExperience: 2 }],
      },
    });
    editor = state.profileEditorReducer(editor, {
      type: "edit",
      draft: Object.assign({}, editor.draft, { headline: "Unsaved headline" }),
    });
    editor = state.profileEditorReducer(editor, {
      type: "section_save_success",
      keys: ["skills"],
      profile: {
        headline: "Saved headline",
        bio: "Saved bio",
        skills: [{ id: "skill_1", name: "Go", proficiency: "Expert", yearsExperience: 3 }],
      },
    });
    assert.equal(editor.draft.headline, "Unsaved headline");
    assert.equal(editor.draft.skills[0].proficiency, "Expert");
    assert.equal(editor.notice, "saved");
    assert.equal(editor.saving, false);
  });

  test("identity forms reject incomplete records before they are sent", () => {
    assert.match(state.validateRecord("professional", "history", { jobTitle: "", company: "Acme" }), /Job title/);
    assert.match(state.validateRecord("professional", "portfolio", { title: "Demo", url: "javascript:alert(1)" }), /http or https/);
    assert.match(state.validateRecord("freelancer", "services", {
      name: "Audit",
      pricingModel: "hourly",
      rateMin: 200,
      rateMax: 40,
    }), /Minimum rate/);
    assert.match(state.validateRecord("creator", "audience", {
      platform: "YouTube",
      metric: "engagement_rate",
      value: 140,
      source: "self_reported",
      measuredAt: "2024-01-01",
    }), /100/);
    assert.equal(state.validateRecord("creator", "featured", {
      title: "Launch film",
      url: "https://video.example/launch",
      format: "video",
    }), "");
    assert.match(state.validateRecord("business", "team", { name: "Ada" }), /Role/);
    assert.match(state.validateRecord("creator", "categories", {
      contentFormats: ["not-a-format"],
    }), /format/i);

    for (const identity of ["professional", "freelancer", "creator", "business"]) {
      for (const section of state.FORM_SPECS[identity].sections) {
        assert.ok(state.SECTION_UI[identity][section.id], identity + " section " + section.id + " needs presentation metadata");
        if (section.collection) {
          assert.equal(typeof section.blank, "function");
          const blank = section.blank();
          const blankMessage = state.validateRecord(identity, section.id, blank);
          const expectsRequired = ["name", "title", "jobTitle", "quote", "platform", "institution", "organization", "company"].some((key) => state.isFieldRequired(identity, section.id, key));
          assert.equal(blankMessage === "" || expectsRequired, true);
          if (expectsRequired) assert.notEqual(blankMessage, "");
        }
      }
    }
  });

  test("resume metadata saves the stored fields and leaves the server timestamp alone", () => {
    const resumeFields = state.sectionById("professional", "resume").fields.map((field) => field.key);
    assert.deepEqual(resumeFields, ["fileName", "targetRole", "contentType", "storageKey", "assetId"]);
    const payload = state.buildSectionPayload("professional", "resume", {
      headline: "Do not send",
      skills: [{ id: "skill_1", name: "Go" }],
      resume: {
        fileName: "cv.pdf",
        targetRole: "Designer",
        contentType: "application/pdf",
        storageKey: "private/resume/cv.pdf",
        uploadedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    assert.deepEqual(Object.keys(payload), ["resume"]);
    assert.equal(payload.resume.fileName, "cv.pdf");
    assert.equal(payload.resume.storageKey, "private/resume/cv.pdf");
    assert.equal(payload.resume.uploadedAt, undefined);
    assert.equal(payload.headline, undefined);
    assert.equal(payload.skills, undefined);
  });

  test("the shared editor follows the student section, modal, and save-failure pattern", () => {
    const editor = fs.readFileSync(path.join(frontendRoot, "components/dashboard/shared/IdentityProfileEditor.jsx"), "utf8");
    assert.match(editor, /role="tablist"/);
    assert.match(editor, /<Modal/);
    assert.match(editor, /Delete/);
    assert.match(editor, /Cancel/);
    assert.match(editor, /Profile was not saved/);
    assert.match(editor, /buildSectionPayload/);
    assert.match(editor, /validateRecord/);
    assert.match(editor, /Add package/);
    assert.match(editor, /does not upload a file/);
    assert.equal(editor.includes("R2"), false);
    assert.equal(editor.includes("type=\"file\""), false);
    assert.match(editor, /Storage reference updated/);
    assert.match(editor, /readOnly/);
    assert.equal(editor.includes("localStorage.setItem(\"c:profiles\""), false);
    assert.equal(editor.includes("c:profiles"), false);
  });

  test("new identity fields stay in their own sections and omit untouched package lists", () => {
    const achievements = state.buildSectionPayload("professional", "achievements", {
      headline: "Keep me out",
      employmentHistory: [{ id: "job_1", jobTitle: "Engineer", company: "Acme", achievements: ["Old role result"] }],
      achievements: [{ id: "ach_1", title: "Published a standard", organization: "IEEE", date: "2024-03-01", evidenceUrl: "https://example.com/proof" }],
    });
    assert.deepEqual(Object.keys(achievements), ["achievements"]);
    assert.equal(achievements.achievements[0].id, "ach_1");
    assert.equal(achievements.employmentHistory, undefined);

    const links = state.buildSectionPayload("professional", "social", {
      contact: { linkedin: "https://www.linkedin.com/in/ada" },
      socialLinks: [{ id: "soc_1", platform: "GitHub", url: "https://github.com/ada", label: "Code" }],
    });
    assert.deepEqual(Object.keys(links), ["socialLinks"]);
    assert.equal(links.contact, undefined);

    const withPackages = state.buildSectionPayload("freelancer", "services", {
      availability: "available",
      services: [{
        id: "svc_1",
        name: "Audit",
        rateMin: 80,
        packages: [{ id: "pkg_1", name: "Starter", price: 400, currency: "USD", features: ["Report"] }],
      }],
    });
    assert.deepEqual(Object.keys(withPackages), ["services"]);
    assert.equal(withPackages.services[0].packages[0].id, "pkg_1");
    assert.equal(withPackages.services[0].rateMin, 80);
    assert.equal(withPackages.availability, undefined);

    const omittedPackages = state.buildSectionPayload("freelancer", "services", {
      services: [{ id: "svc_1", name: "Audit", rateMin: 80 }],
    });
    assert.equal(Object.prototype.hasOwnProperty.call(omittedPackages.services[0], "packages"), false);

    const clearedPackages = state.buildSectionPayload("freelancer", "services", {
      services: [{ id: "svc_1", name: "Audit", packages: [] }],
    });
    assert.deepEqual(clearedPackages.services[0].packages, []);

    assert.match(state.validateRecord("freelancer", "about", { engagementTypes: ["retainer", "forever"] }), /engagement type/i);
    assert.equal(state.validateRecord("freelancer", "about", { engagementTypes: ["fixed_price", "hourly"] }), "");
    assert.match(state.validateRecord("freelancer", "experience", {
      jobTitle: "Designer",
      company: "Acme",
      startDate: "2024-02-01",
      endDate: "2024-01-01",
    }), /End date/);
    assert.match(state.validateRecord("freelancer", "experience", {
      jobTitle: "Designer",
      company: "Acme",
      isCurrent: true,
      endDate: "2024-06-01",
    }), /current role/i);
    assert.match(state.validateRecord("freelancer", "services", {
      name: "Audit",
      packages: [{ name: "Starter", price: 10 }],
    }), /Currency is required/);
    assert.match(state.validateRecord("business", "products", { name: "Lamp", price: 40 }), /Currency is required/);
    assert.equal(state.validateRecord("business", "products", { name: "Lamp" }), "");
    assert.match(state.validateRecord("business", "about", { foundedYear: 2999 }), /between/);
    assert.match(state.validateRecord("business", "credentials", {
      title: "Award",
      issueDate: "2024-05-01",
      expirationDate: "2024-01-01",
    }), /Expiration date/);
    assert.match(state.validateRecord("creator", "featured", {
      title: "Film",
      url: "https://video.example/film",
      thumbnailUrl: "javascript:alert(1)",
    }), /http or https/);
    assert.equal(state.validateRecord("creator", "about", { displayName: "Ada", headline: "Essays", niche: "Writing" }), "");

    const creator = state.buildSectionPayload("creator", "about", {
      displayName: "Ada",
      headline: "Essays",
      niche: "Writing",
      bio: "Long form",
      collaboration: { openToCollab: true },
    });
    assert.deepEqual(Object.keys(creator).sort(), ["bio", "displayName", "headline", "niche"]);

    const past = state.buildSectionPayload("creator", "past", {
      collaboration: { openToCollab: true },
      pastCollaborations: [{ id: "col_1", organization: "Northwind", title: "Spring drop", url: "https://northwind.example/drop" }],
    });
    assert.deepEqual(Object.keys(past), ["pastCollaborations"]);
  });
});

describe("Identity forms cover the persisted domain contracts", () => {
  const ts = require(path.join(__dirname, "..", "node_modules", "typescript"));
  require.extensions[".ts"] = function (module, filename) {
    const content = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    module._compile(compiled.outputText, filename);
  };
  const contracts = require(path.join(__dirname, "..", "lib", "domain-profile", "contracts.ts"));

  function sectionFor(identity, key) {
    const sections = state.FORM_SPECS[identity].sections;
    const exact = sections.find((section) => section.collection === key || section.object === key);
    if (exact) return exact;
    return sections.find((section) => section.fields.some((field) => field.key === key || field.key.startsWith(key + ".")));
  }

  function assertFields(identity, fields, section, prefix) {
    for (const [key, spec] of Object.entries(fields)) {
      const pathName = prefix ? prefix + "." + key : key;
      if (spec.kind === "object") {
        assertFields(identity, spec.fields, section, pathName);
        continue;
      }
      if (spec.kind === "collection") {
        assert.equal(section.nested && section.nested.key, key, identity + " form is missing nested " + pathName);
        assertFields(identity, spec.fields, { fields: section.nested.fields, nested: null }, "");
        continue;
      }
      const present = section.fields.some((field) => field.key === pathName);
      assert.equal(present, true, identity + " form is missing " + pathName);
    }
  }

  test("every persisted field is present on the matching identity form", () => {
    const byIdentity = {
      professional: contracts.professionalContract,
      freelancer: contracts.freelancerContract,
      creator: contracts.creatorContract,
      business: contracts.businessContract,
    };
    for (const [identity, contract] of Object.entries(byIdentity)) {
      for (const [key, spec] of Object.entries(contract.fields)) {
        const section = sectionFor(identity, key);
        assert.ok(section, identity + " form is missing " + key);
        if (spec.kind === "collection" || spec.kind === "object") {
          const managed = new Set((spec.managed || []).map((rule) => rule.key));
          const visible = {};
          for (const [childKey, childSpec] of Object.entries(spec.fields)) {
            if (!managed.has(childKey)) visible[childKey] = childSpec;
          }
          assertFields(identity, visible, section, spec.kind === "object" ? "" : "");
        }
      }
    }
  });
});
