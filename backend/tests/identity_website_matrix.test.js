/**
 * Phase 8 — Five-identity website matrix.
 *
 * For every identity (student, professional, freelancer, creator, business)
 * this suite exercises the real save route, MongoDB persistence, preview,
 * publication, the public snapshot, the Magic UI adapter, stable record ids,
 * record/section custom fields, partial saves, visibility, and privacy.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const portfolioRoot = path.resolve(projectRoot, "..", "portfolio");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));

if (!require.extensions[".ts"]) {
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
}

const mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));

const { loadEnvConfig } = require(path.join(projectRoot, "node_modules", "@next", "env"));
const { combinedEnv } = loadEnvConfig(projectRoot, true, { info() {}, error() {} });
const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
const jwtSecret = combinedEnv.JWT_SECRET || process.env.JWT_SECRET || "fallback_secret";
if (!uri) {
  throw new Error("MONGODB_URI is not set. Define it in backend/.env.local.");
}

process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;

const BASE = "http://localhost:3000";
const RUN = Date.now();

let User, StudentProfile, ProfessionalProfile, FreelancerProfile, CreatorProfile, BusinessProfile;
let UserWebsiteConfig, PublishedProfileRevision;
let studentProfileRoute, professionalRoute, freelancerRoute, creatorRoute, businessRoute;
let configRoute, previewRoute, publishRoute, publicProfileRoute, rollbackRoute, contractRoute;
let adaptOneVueProfile;

function authed(pathname, token, method = "GET", body) {
  return new Request(`${BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function tokenFor(user) {
  return jwt.sign({ id: user._id.toString(), email: user.email }, jwtSecret);
}

async function publicRequest(username) {
  return publicProfileRoute.GET(
    new Request(`${BASE}/api/public/profile/${username}`),
    { params: Promise.resolve({ username }) },
  );
}

function field(id, label, value, order = 0, visibility = "public") {
  return { id, label, type: "text", visibility, order, value };
}

function matrixLayout({ builtinKey, recordId, recordNote, sectionNote }) {
  const sectionField = {
    id: "fld_matrixrec",
    key: "record_note",
    label: "Record layout note",
    type: "text",
    required: false,
    visibility: "public",
    order: 0,
    helpText: "",
    placeholder: "",
    retired: false,
    config: {},
  };
  const sectionOnlyField = {
    id: "fld_matrixnote",
    key: "matrix_note",
    label: "Matrix note",
    type: "text",
    required: false,
    visibility: "public",
    order: 0,
    helpText: "",
    placeholder: "",
    retired: false,
    config: {},
  };
  return {
    schemaVersion: 1,
    revision: 0,
    sections: [
      {
        id: "sec_matrix01",
        key: builtinKey,
        title: "Record extras",
        builtinKey,
        visibility: "public",
        order: 0,
        repeatable: true,
        fields: [sectionField],
      },
      {
        id: "sec_matrix02",
        key: "matrix_notes",
        title: "Matrix notes",
        builtinKey: "",
        visibility: "public",
        order: 1,
        repeatable: false,
        fields: [sectionOnlyField],
      },
    ],
    bindings: [
      { sectionId: "sec_matrix01", recordId, values: { fld_matrixrec: recordNote } },
      { sectionId: "sec_matrix02", recordId: "", values: { fld_matrixnote: sectionNote } },
    ],
    entries: [],
  };
}

function customSectionsValue(dto, title) {
  const section = (dto.customSections || []).find((item) => item.title === title);
  if (!section) return undefined;
  return section.records[0]?.fields[0]?.value;
}

function recordNoteOf(records, id) {
  const record = (records || []).find((item) => item.id === id);
  return (record?.customFields || []).map((item) => item.value);
}

const FIXTURES = [
  {
    identity: "student",
    prefix: "stu",
    route: () => studentProfileRoute,
    profilePath: "/api/student/profile",
    model: () => StudentProfile,
    collection: "education",
    primarySection: "education",
    primaryRenderer: "education",
    hiddenRenderer: "projects",
    visible: ["about", "education", "contact"],
    order: ["contact", "education", "about"],
    publicRecords: (dto) => dto.education || [],
    recordAId: "edu_matrix_a",
    recordBId: "edu_matrix_b",
    privateSecrets: ["2025550100"],
    body(layout) {
      const customFields = [
        field("fld_matrixpub1", "Matrix note", "Record note student"),
        field("fld_matrixpriv", "Private note", "PRIVATE-note-student", 1, "private"),
      ];
      return {
        preferredName: "Matrix Student",
        headline: "Student matrix headline",
        bio: "Student matrix bio",
        education: [
          { id: "edu_matrix_a", institution: "Matrix University", degree: "BSc", fieldOfStudy: "Computing", currentStatus: "completed", customFields },
          { id: "edu_matrix_b", institution: "Second School", degree: "MSc", fieldOfStudy: "Science", currentStatus: "completed" },
        ],
        projects: [{ id: "proj_hidden01", title: "Hidden project", shortDescription: "Not shown" }],
        contacts: { phone: "+12025550100", visibility: { phone: "private", email: "private" } },
        customLayout: layout,
      };
    },
    resave() {
      return {
        education: [
          { id: "edu_matrix_b", institution: "Second School", degree: "MSc", fieldOfStudy: "Science", currentStatus: "completed" },
          { id: "edu_matrix_a", institution: "Matrix University", degree: "BSc", fieldOfStudy: "Computing", currentStatus: "completed" },
        ],
      };
    },
    assertPreserved(record) {
      assert.equal(record.id, "edu_matrix_a");
      assert.equal(record.fieldOfStudy, "Computing");
    },
  },
  {
    identity: "professional",
    prefix: "pro",
    route: () => professionalRoute,
    profilePath: "/api/professional/profile",
    model: () => ProfessionalProfile,
    collection: "certifications",
    primarySection: "certifications",
    primaryRenderer: "credentials",
    hiddenRenderer: "projects",
    visible: ["about", "credentials", "contact"],
    order: ["contact", "credentials", "about"],
    publicRecords: (dto) => dto.credentials || [],
    recordAId: "cert_matrix_a",
    recordBId: "cert_matrix_b",
    privateSecrets: ["2025550101"],
    body(layout) {
      const customFields = [
        field("fld_matrixpub1", "Matrix note", "Record note professional"),
        field("fld_matrixpriv", "Private note", "PRIVATE-note-professional", 1, "private"),
      ];
      return {
        headline: "Professional matrix headline",
        bio: "Professional matrix bio",
        certifications: [
          { id: "cert_matrix_a", title: "Cloud Cert", issuer: "Example", credentialId: "CERT-123", customFields },
          { id: "cert_matrix_b", title: "Second Cert", issuer: "Second" },
        ],
        portfolio: [{ id: "proj_hidden01", title: "Hidden project", description: "Not shown" }],
        contact: { phone: "+12025550101", visibility: { phone: "private" } },
        customLayout: layout,
      };
    },
    resave() {
      return {
        certifications: [
          { id: "cert_matrix_b", title: "Second Cert", issuer: "Second" },
          { id: "cert_matrix_a", title: "Cloud Cert", issuer: "Example" },
        ],
      };
    },
    assertPreserved(record) {
      assert.equal(record.id, "cert_matrix_a");
      assert.equal(record.credentialId, "CERT-123");
    },
  },
  {
    identity: "freelancer",
    prefix: "fre",
    route: () => freelancerRoute,
    profilePath: "/api/freelancer/profile",
    model: () => FreelancerProfile,
    collection: "portfolio",
    primarySection: "portfolio",
    primaryRenderer: "caseStudies",
    hiddenRenderer: "services",
    visible: ["about", "caseStudies", "contact"],
    order: ["contact", "caseStudies", "about"],
    publicRecords: (dto) => (dto.projects || []).filter((item) => item.projectType === "case-study"),
    recordAId: "proj_matrix_a",
    recordBId: "proj_matrix_b",
    privateSecrets: ["2025550102"],
    body(layout) {
      const customFields = [
        field("fld_matrixpub1", "Matrix note", "Record note freelancer"),
        field("fld_matrixpriv", "Private note", "PRIVATE-note-freelancer", 1, "private"),
      ];
      return {
        headline: "Freelancer matrix headline",
        bio: "Freelancer matrix bio",
        portfolio: [
          { id: "proj_matrix_a", title: "Case A", summary: "Summary A", url: "https://example.com/a", customFields },
          { id: "proj_matrix_b", title: "Case B", summary: "Summary B", url: "https://example.com/b" },
        ],
        services: [{ id: "service_hidden01", name: "Hidden service" }],
        contact: { phone: "+12025550102", visibility: { phone: "private" } },
        customLayout: layout,
      };
    },
    resave() {
      return {
        portfolio: [
          { id: "proj_matrix_b", title: "Case B" },
          { id: "proj_matrix_a", title: "Case A" },
        ],
      };
    },
    assertPreserved(record) {
      assert.equal(record.id, "proj_matrix_a");
      assert.equal(record.summary, "Summary A");
      assert.equal(record.url, "https://example.com/a");
    },
  },
  {
    identity: "creator",
    prefix: "cre",
    route: () => creatorRoute,
    profilePath: "/api/creator/profile",
    model: () => CreatorProfile,
    collection: "featuredContent",
    primarySection: "featuredContent",
    primaryRenderer: "featured",
    hiddenRenderer: "media",
    visible: ["about", "featured", "contact"],
    order: ["contact", "featured", "about"],
    publicRecords: (dto) => (dto.projects || []).filter((item) => item.projectType === "video"),
    recordAId: "content_matrix_a",
    recordBId: "content_matrix_b",
    privateSecrets: ["PRIVATE-creator@example.com"],
    body(layout) {
      const customFields = [
        field("fld_matrixpub1", "Matrix note", "Record note creator"),
        field("fld_matrixpriv", "Private note", "PRIVATE-note-creator", 1, "private"),
      ];
      return {
        displayName: "Matrix Creator",
        headline: "Creator matrix headline",
        bio: "Creator matrix bio",
        featuredContent: [
          { id: "content_matrix_a", title: "Feature A", url: "https://example.com/a", format: "video", summary: "Summary A", thumbnailUrl: "https://example.com/a.png", customFields },
          { id: "content_matrix_b", title: "Feature B", url: "https://example.com/b", format: "video", summary: "Summary B", thumbnailUrl: "https://example.com/b.png" },
        ],
        contact: { email: "PRIVATE-creator@example.com", visibility: { email: "private" } },
        customLayout: layout,
      };
    },
    resave() {
      return {
        featuredContent: [
          { id: "content_matrix_b", title: "Feature B", url: "https://example.com/b", format: "video" },
          { id: "content_matrix_a", title: "Feature A", url: "https://example.com/a", format: "video" },
        ],
      };
    },
    assertPreserved(record) {
      assert.equal(record.id, "content_matrix_a");
      assert.equal(record.summary, "Summary A");
      assert.equal(record.thumbnailUrl, "https://example.com/a.png");
    },
  },
  {
    identity: "business",
    prefix: "biz",
    route: () => businessRoute,
    profilePath: "/api/business/profile",
    model: () => BusinessProfile,
    collection: "products",
    primarySection: "products",
    primaryRenderer: "products",
    hiddenRenderer: "services",
    visible: ["about", "products", "contact"],
    order: ["contact", "products", "about"],
    publicRecords: (dto) => (dto.projects || []).filter((item) => item.projectType === "product"),
    recordAId: "product_matrix_a",
    recordBId: "product_matrix_b",
    privateSecrets: ["REG-SECRET-BUSINESS", "PRIVATE-business@example.com"],
    body(layout) {
      const customFields = [
        field("fld_matrixpub1", "Matrix note", "Record note business"),
        field("fld_matrixpriv", "Private note", "PRIVATE-note-business", 1, "private"),
      ];
      return {
        businessName: "Matrix Business",
        tagline: "Business matrix headline",
        description: "Business matrix bio",
        products: [
          { id: "product_matrix_a", name: "Widget", description: "Description A", customFields },
          { id: "product_matrix_b", name: "Gadget", description: "Description B" },
        ],
        services: [{ id: "service_hidden01", name: "Hidden service" }],
        registration: { legalName: "Matrix Business", registrationNumber: "REG-SECRET-BUSINESS" },
        publicContact: { email: "PRIVATE-business@example.com", visibility: { email: "private" } },
        customLayout: layout,
      };
    },
    resave() {
      return {
        products: [
          { id: "product_matrix_b", name: "Gadget" },
          { id: "product_matrix_a", name: "Widget" },
        ],
      };
    },
    assertPreserved(record) {
      assert.equal(record.id, "product_matrix_a");
      assert.equal(record.description, "Description A");
    },
  },
];

describe("Phase 8 — every identity round-trips through save, preview, publish, and render", () => {
  const users = new Map();
  const usernames = new Map();
  const createdUserIds = [];
  let outsider, outsiderToken;

  before(async () => {
    await mongoose.connect(uri);

    User = require(path.join(projectRoot, "models", "User.ts")).default;
    StudentProfile = require(path.join(projectRoot, "models", "StudentProfile.ts")).default;
    ProfessionalProfile = require(path.join(projectRoot, "models", "ProfessionalProfile.ts")).default;
    FreelancerProfile = require(path.join(projectRoot, "models", "FreelancerProfile.ts")).default;
    CreatorProfile = require(path.join(projectRoot, "models", "CreatorProfile.ts")).default;
    BusinessProfile = require(path.join(projectRoot, "models", "BusinessProfile.ts")).default;
    UserWebsiteConfig = require(path.join(projectRoot, "models", "UserWebsiteConfig.ts")).default;
    PublishedProfileRevision = require(path.join(projectRoot, "models", "PublishedProfileRevision.ts")).default;

    studentProfileRoute = require(path.join(projectRoot, "app", "api", "student", "profile", "route.ts"));
    professionalRoute = require(path.join(projectRoot, "app", "api", "professional", "profile", "route.ts"));
    freelancerRoute = require(path.join(projectRoot, "app", "api", "freelancer", "profile", "route.ts"));
    creatorRoute = require(path.join(projectRoot, "app", "api", "creator", "profile", "route.ts"));
    businessRoute = require(path.join(projectRoot, "app", "api", "business", "profile", "route.ts"));
    configRoute = require(path.join(projectRoot, "app", "api", "student", "website", "config", "route.ts"));
    previewRoute = require(path.join(projectRoot, "app", "api", "student", "website", "preview", "route.ts"));
    publishRoute = require(path.join(projectRoot, "app", "api", "student", "website", "publish", "route.ts"));
    publicProfileRoute = require(path.join(projectRoot, "app", "api", "public", "profile", "[username]", "route.ts"));
    rollbackRoute = require(path.join(projectRoot, "app", "api", "student", "website", "rollback", "route.ts"));
    contractRoute = require(path.join(projectRoot, "app", "api", "website", "contract", "route.ts"));

    adaptOneVueProfile = require(path.join(portfolioRoot, "src", "lib", "onevue-profile-adapter.ts")).adaptOneVueProfile;

    for (const fixture of FIXTURES) {
      const user = await User.create({
        name: `Matrix ${fixture.identity}`,
        email: `matrix_${fixture.identity}_${RUN}@example.com`,
        password: "hashed_password",
        identity: fixture.identity,
      });
      users.set(fixture.identity, { user, token: tokenFor(user) });
      usernames.set(fixture.identity, `m${fixture.prefix}${RUN}`);
      createdUserIds.push(user._id);
    }

    outsider = await User.create({
      name: "Matrix Outsider",
      email: `matrix_outsider_${RUN}@example.com`,
      password: "hashed_password",
      identity: "professional",
    });
    outsiderToken = tokenFor(outsider);
    createdUserIds.push(outsider._id);
  });

  after(async () => {
    if (createdUserIds.length) {
      await Promise.all([
        User.deleteMany({ _id: { $in: createdUserIds } }),
        StudentProfile.deleteMany({ userId: { $in: createdUserIds } }),
        ProfessionalProfile.deleteMany({ userId: { $in: createdUserIds } }),
        FreelancerProfile.deleteMany({ userId: { $in: createdUserIds } }),
        CreatorProfile.deleteMany({ userId: { $in: createdUserIds } }),
        BusinessProfile.deleteMany({ userId: { $in: createdUserIds } }),
        UserWebsiteConfig.deleteMany({ userId: { $in: createdUserIds } }),
        PublishedProfileRevision.deleteMany({ userId: { $in: createdUserIds } }),
      ]);
    }
    await mongoose.disconnect();
  });

  for (const fixture of FIXTURES) {
    test(`${fixture.identity}: saves, reloads, reorders, previews, publishes, and renders`, async () => {
      const { user, token } = users.get(fixture.identity);
      const username = usernames.get(fixture.identity);
      const route = fixture.route();
      const layout = matrixLayout({
        builtinKey: fixture.collection,
        recordId: fixture.recordAId,
        recordNote: `Layout record note ${fixture.identity}`,
        sectionNote: `Layout note ${fixture.identity}`,
      });

      // 1. Identity Page save -> database -> profile reload.
      const saved = await route.PUT(authed(fixture.profilePath, token, "PUT", fixture.body(layout)));
      const savedBody = await saved.json();
      assert.equal(saved.status, 200, JSON.stringify(savedBody));
      assert.ok(savedBody.profile, "save returns the stored profile");

      const reloaded = await route.GET(authed(fixture.profilePath, token));
      const reloadedBody = await reloaded.json();
      assert.equal(reloaded.status, 200);
      const reloadedRecords = reloadedBody.profile[fixture.collection];
      assert.equal(reloadedRecords.length, 2);
      assert.equal(reloadedRecords[0].id, fixture.recordAId);
      assert.equal(reloadedBody.profile.customLayout.sections.length, 2);
      assert.equal(recordNoteOf(reloadedRecords, fixture.recordAId)[0], `Record note ${fixture.identity}`);

      const beforeDoc = await fixture.model().findOne({ userId: user._id }).lean();
      const storedObjectIds = beforeDoc[fixture.collection].map((item) => String(item._id));

      // 10 + 11. Reorder by id only, omitting custom fields and optional values.
      const resaved = await route.PUT(authed(fixture.profilePath, token, "PUT", fixture.resave(layout)));
      const resavedBody = await resaved.json();
      assert.equal(resaved.status, 200, JSON.stringify(resavedBody));
      const reordered = resavedBody.profile[fixture.collection];
      assert.deepEqual(reordered.map((item) => item.id), [fixture.recordBId, fixture.recordAId]);
      const recordA = reordered.find((item) => item.id === fixture.recordAId);
      fixture.assertPreserved(recordA);
      assert.equal(recordNoteOf(reordered, fixture.recordAId)[0], `Record note ${fixture.identity}`);
      const afterDoc = await fixture.model().findOne({ userId: user._id }).lean();
      assert.deepEqual(
        afterDoc[fixture.collection].map((item) => String(item._id)),
        [storedObjectIds[1], storedObjectIds[0]],
        "reordering keeps the stored subdocument ids attached to their records",
      );
      // An update that only names one collection leaves the others intact.
      if (fixture.identity === "student") {
        assert.equal(afterDoc.projects[0].title, "Hidden project");
      } else if (fixture.identity === "professional") {
        assert.equal(afterDoc.portfolio[0].title, "Hidden project");
      } else if (fixture.identity === "freelancer" || fixture.identity === "business") {
        assert.equal(afterDoc.services[0].name, "Hidden service");
      }

      // 8. Customization persists as a draft before publication.
      const config = await configRoute.PUT(authed("/api/student/website/config", token, "PUT", {
        username,
        selectedTemplateId: "magicui-portfolio",
        customization: {
          accentColor: "#112233",
          themeMode: "dark",
          visibleSections: fixture.visible,
          sectionOrder: fixture.order,
        },
      }));
      const configBody = await config.json();
      assert.equal(config.status, 200, JSON.stringify(configBody));
      const draftConfig = await configRoute.GET(authed("/api/student/website/config", token));
      const draftConfigBody = await draftConfig.json();
      assert.deepEqual(draftConfigBody.config.customization.visibleSections, fixture.visible);
      assert.deepEqual(draftConfigBody.config.customization.sectionOrder.slice(0, 3), fixture.order);
      assert.equal(draftConfigBody.config.status, "draft");

      // 2 + 3 + 7. Preview carries the same content and custom fields as the saved profile.
      const preview = await previewRoute.GET(authed("/api/student/website/preview", token));
      const previewBody = await preview.json();
      assert.equal(preview.status, 200, JSON.stringify(previewBody));
      assert.equal(previewBody.identity, fixture.identity);
      const previewRecords = fixture.publicRecords(previewBody.dto);
      assert.deepEqual(previewRecords.map((item) => item.id), [fixture.recordBId, fixture.recordAId]);
      assert.equal(recordNoteOf(previewRecords, fixture.recordAId)[0], `Record note ${fixture.identity}`);
      assert.equal(customSectionsValue(previewBody.dto, "Matrix notes"), `Layout note ${fixture.identity}`);
      assert.equal(customSectionsValue(previewBody.dto, "Record extras"), `Layout record note ${fixture.identity}`);
      assert.deepEqual(previewBody.config.customization.visibleSections, fixture.visible);
      assert.equal(previewBody.config.status, "draft");

      // 9. Private record and identity data never reach the preview.
      const previewText = JSON.stringify(previewBody.dto);
      for (const secret of fixture.privateSecrets) {
        assert.equal(previewText.includes(secret), false, `preview leaks ${secret}`);
      }

      // Publish and read the frozen public snapshot.
      const published = await publishRoute.POST(authed("/api/student/website/publish", token, "POST"));
      const publishedBody = await published.json();
      assert.equal(published.status, 200, JSON.stringify(publishedBody));
      assert.equal(publishedBody.revision.revisionNumber, 1);

      const publicRes = await publicRequest(username);
      const publicBody = await publicRes.json();
      assert.equal(publicRes.status, 200, JSON.stringify(publicBody));
      assert.equal(publicBody.website.identity, fixture.identity);
      assert.equal(publicBody.website.templateId, "magicui-portfolio");

      // 7. Preview and published snapshot agree on content and custom fields.
      assert.deepEqual(fixture.publicRecords(publicBody.dto), previewRecords);
      assert.equal(customSectionsValue(publicBody.dto, "Matrix notes"), `Layout note ${fixture.identity}`);
      assert.equal(customSectionsValue(publicBody.dto, "Record extras"), `Layout record note ${fixture.identity}`);
      assert.deepEqual(publicBody.website.customization.visibleSections, fixture.visible);
      assert.deepEqual(publicBody.website.customization.sectionOrder.slice(0, 3), fixture.order);

      // 9. The public snapshot omits private record fields and private identity data.
      const publicText = JSON.stringify(publicBody.dto);
      for (const secret of fixture.privateSecrets) {
        assert.equal(publicText.includes(secret), false, `public snapshot leaks ${secret}`);
      }

      // 2 + 6. The renderer receives only the configured sections, in order.
      const adapted = adaptOneVueProfile(publicBody.dto, publicBody.website);
      assert.equal(adapted.visibleSections[fixture.primaryRenderer], true);
      assert.equal(adapted.visibleSections[fixture.hiddenRenderer], false);
      assert.equal(adapted.visibleSections.custom, true);
      assert.ok(adapted.sectionOrder.indexOf("contact") < adapted.sectionOrder.indexOf(fixture.primaryRenderer));
      assert.equal(adapted.accentColor, "#112233");
      assert.equal(adapted.themeMode, "dark");
    });
  }

  test("5. the registry rejects an unregistered template and serves distinct identity contracts", async () => {
    const { token } = users.get("student");
    const rejected = await configRoute.PUT(authed("/api/student/website/config", token, "PUT", {
      selectedTemplateId: "not-a-registered-template",
    }));
    const rejectedBody = await rejected.json();
    assert.equal(rejected.status, 400);
    assert.match(rejectedBody.message, /not in the approved template registry/i);

    const stillValid = await configRoute.GET(authed("/api/student/website/config", token));
    const stillValidBody = await stillValid.json();
    assert.equal(stillValidBody.config.selectedTemplateId, "magicui-portfolio");

    const contractRes = await contractRoute.GET(new Request(`${BASE}/api/website/contract`));
    const contractBody = await contractRes.json();
    assert.equal(contractRes.status, 200);
    assert.deepEqual([...contractBody.identities].sort(), ["business", "creator", "freelancer", "professional", "student"]);
    const byIdentity = Object.fromEntries(contractBody.contracts.map((item) => [item.identity, item]));
    assert.deepEqual(Object.keys(byIdentity).sort(), ["business", "creator", "freelancer", "professional", "student"]);

    for (const identity of Object.keys(byIdentity)) {
      const contract = byIdentity[identity];
      assert.ok(contract.label, `${identity} has a label`);
      assert.ok(contract.heading, `${identity} has a heading`);
      assert.ok(contract.defaultSections.visible.length > 0, `${identity} has default sections`);
      assert.equal(contract.templateCompatibility.supported, true, `${identity} is supported by the adapter`);
    }

    // 4. Section defaults differ by identity instead of borrowing student defaults.
    const sectionIds = (identity) => byIdentity[identity].sections.map((item) => item.id);
    assert.ok(sectionIds("student").includes("education"));
    assert.ok(sectionIds("professional").includes("education"));
    assert.equal(sectionIds("freelancer").includes("education"), false);
    assert.ok(sectionIds("freelancer").includes("services"));
    assert.ok(sectionIds("creator").includes("featured"));
    assert.equal(sectionIds("creator").includes("services"), false);
    assert.ok(sectionIds("business").includes("products"));
    assert.ok(sectionIds("business").includes("team"));
    assert.equal(sectionIds("professional").includes("team"), false);
  });

  test("12. rollback and ownership are enforced for a domain identity", async () => {
    const rollbackUser = await User.create({
      name: "Matrix Rollback",
      email: `matrix_rollback_${RUN}@example.com`,
      password: "hashed_password",
      identity: "professional",
    });
    createdUserIds.push(rollbackUser._id);
    const token = tokenFor(rollbackUser);
    const username = `mrb${RUN}`;
    const route = professionalRoute;

    const save = (headline) => route.PUT(authed("/api/professional/profile", token, "PUT", {
      headline,
      certifications: [
        { id: "cert_rollback_a", title: "Rollback cert", issuer: "Example" },
      ],
    }));
    assert.equal((await save("Rollback One")).status, 200);

    const config = await configRoute.PUT(authed("/api/student/website/config", token, "PUT", {
      username,
      selectedTemplateId: "magicui-portfolio",
      customization: { accentColor: "#112233", themeMode: "dark", visibleSections: ["about", "credentials", "contact"] },
    }));
    assert.equal(config.status, 200);

    assert.equal((await publishRoute.POST(authed("/api/student/website/publish", token, "POST"))).status, 200);
    assert.equal((await save("Rollback Two")).status, 200);
    assert.equal((await publishRoute.POST(authed("/api/student/website/publish", token, "POST"))).status, 200);

    let publicBody = await (await publicRequest(username)).json();
    assert.equal(publicBody.dto.profile.headline, "Rollback Two");

    const outsiderRollback = await rollbackRoute.POST(authed("/api/student/website/rollback", outsiderToken, "POST", {
      revisionNumber: 1,
    }));
    assert.equal(outsiderRollback.status, 404);
    publicBody = await (await publicRequest(username)).json();
    assert.equal(publicBody.dto.profile.headline, "Rollback Two");

    const ownerRollback = await rollbackRoute.POST(authed("/api/student/website/rollback", token, "POST", {
      revisionNumber: 1,
    }));
    assert.equal(ownerRollback.status, 200);
    publicBody = await (await publicRequest(username)).json();
    assert.equal(publicBody.dto.profile.headline, "Rollback One");

    const missing = await rollbackRoute.POST(authed("/api/student/website/rollback", token, "POST", {
      revisionNumber: 99,
    }));
    assert.equal(missing.status, 404);
  });
});
