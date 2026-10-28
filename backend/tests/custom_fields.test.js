/**
 * Global custom-field engine. These checks do not need a database.
 * Asset ownership against StoredAsset is covered when MONGODB_URI is set.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));
if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const content = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    module._compile(compiled.outputText, filename);
  };
}

const { ProfileValidationError } = require(path.join(projectRoot, "lib", "domain-profile", "validate.ts"));
const {
  normalizeCustomLayout,
  projectCustomLayout,
  collectCustomAssetBindings,
  builtinSections,
  fieldCompatibility,
} = require(path.join(projectRoot, "lib", "custom-fields", "index.ts"));
const { toPublicProfileDTO, allowlistPublicSnapshot } = require(path.join(projectRoot, "lib", "public-profile-dto.ts"));

const NOW = "2026-10-27T00:00:00.000Z";
const ASSET = "ast_" + "ab".repeat(12);

function field(type, extra = {}) {
  return {
    id: extra.id || "fld_" + type + "000000",
    key: extra.key || type + "_key",
    label: extra.label || type,
    type,
    required: extra.required === true,
    visibility: extra.visibility || "public",
    order: extra.order || 0,
    helpText: extra.helpText || "",
    placeholder: "",
    config: extra.config,
    retired: extra.retired === true,
    ...(extra.scope ? { scope: extra.scope } : {}),
    ...(extra.targetRecordId ? { targetRecordId: extra.targetRecordId } : {}),
    ...(extra.mapsTo ? { mapsTo: extra.mapsTo } : {}),
  };
}

function educationLayout(fields, bindings) {
  return {
    schemaVersion: 1,
    revision: 0,
    sections: [
      {
        id: "sec_education01",
        key: "education",
        title: "Education",
        builtinKey: "education",
        visibility: "public",
        order: 0,
        repeatable: true,
        fields,
      },
    ],
    bindings: bindings || [],
    entries: [],
  };
}

describe("custom field definitions", () => {
  test("accepts every supported type and rejects an unknown type", () => {
    const types = ["text", "textarea", "number", "url", "date", "boolean", "select", "multiselect", "tags", "image", "gallery", "video", "file"];
    const fields = types.map((type, index) => field(type, {
      id: "fld_" + String(index).padStart(8, "0"),
      order: index,
      config: type === "select" || type === "multiselect"
        ? { options: [{ value: "ml", label: "Machine learning" }] }
        : undefined,
    }));
    const layout = normalizeCustomLayout(educationLayout(fields), {
      identity: "student",
      recordIds: { education: [] },
      now: NOW,
    });
    assert.equal(layout.sections[0].fields.length, types.length);
    assert.throws(
      () => normalizeCustomLayout(educationLayout([field("script", { id: "fld_script0001", type: "script" })]), {
        identity: "student",
        recordIds: { education: [] },
        now: NOW,
      }),
      (error) => error instanceof ProfileValidationError && /unsupported type/.test(error.message)
    );
  });

  test("keeps the field id and key when the label changes", () => {
    const created = normalizeCustomLayout(educationLayout([
      field("text", { id: "fld_research01", key: "research_area", label: "Research area" }),
    ]), { identity: "student", recordIds: { education: [] }, now: NOW });
    const next = educationLayout([
      field("text", { id: "fld_research01", key: "thesis_topic", label: "Thesis topic" }),
    ]);
    next.revision = created.revision;
    const renamed = normalizeCustomLayout(next, { identity: "student", existing: created, recordIds: { education: [] }, now: "2026-10-27T01:00:00.000Z" });
    assert.equal(renamed.sections[0].fields[0].id, "fld_research01");
    assert.equal(renamed.sections[0].fields[0].key, "research_area");
    assert.equal(renamed.sections[0].fields[0].label, "Thesis topic");
  });

  test("rejects a select option that is not configured and reorders fields", () => {
    const layout = normalizeCustomLayout(educationLayout([
      field("text", { id: "fld_first00001", label: "First", order: 0 }),
      field("text", { id: "fld_second0001", label: "Second", order: 1 }),
    ]), { identity: "student", recordIds: { education: [] }, now: NOW });
    assert.deepEqual(layout.sections[0].fields.map((item) => item.label), ["First", "Second"]);
    const reordered = normalizeCustomLayout(educationLayout([
      field("text", { id: "fld_second0001", label: "Second", order: 0 }),
      field("text", { id: "fld_first00001", label: "First", order: 5 }),
    ]), { identity: "student", recordIds: { education: [] }, now: NOW });
    assert.deepEqual(reordered.sections[0].fields.map((item) => item.label), ["Second", "First"]);
    assert.throws(
      () => normalizeCustomLayout({
        schemaVersion: 1,
        revision: 0,
        sections: [{
          id: "sec_education01",
          title: "Education",
          builtinKey: "education",
          fields: [field("select", { id: "fld_choice0001", config: { options: [{ value: "a", label: "A" }] } })],
        }],
        bindings: [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_choice0001: "nope" } }],
        entries: [],
      }, { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW }),
      (error) => error instanceof ProfileValidationError
    );
  });

  test("retires a field without deleting its stored value and drops it from the public snapshot", () => {
    const layout = normalizeCustomLayout(educationLayout(
      [field("text", { id: "fld_retired001", label: "Old score", retired: true })],
      [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_retired001: "hidden" } }]
    ), { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW });
    assert.equal(layout.bindings[0].values.fld_retired001, "hidden");
    const published = projectCustomLayout(layout, { templateId: "magicui-portfolio", assetHref: () => "" });
    assert.equal(published.length, 0);
  });
});

describe("custom field values", () => {
  test("stores different values on two education records and allows a missing optional value", () => {
    const layout = normalizeCustomLayout(educationLayout(
      [field("text", { id: "fld_area000001", label: "Research area" })],
      [
        { sectionId: "sec_education01", recordId: "edu_1", values: { fld_area000001: "Graphics" } },
        { sectionId: "sec_education01", recordId: "edu_2", values: {} },
      ]
    ), { identity: "student", recordIds: { education: ["edu_1", "edu_2"] }, now: NOW });
    assert.equal(layout.bindings[0].values.fld_area000001, "Graphics");
    assert.deepEqual(layout.bindings[1].values, {});
  });

  test("enforces required values, bounds, urls, and file references only at publish", () => {
    const base = educationLayout(
      [field("number", { id: "fld_score00001", label: "Score", required: true, config: { min: 0, max: 100, integer: true } })],
      [{ sectionId: "sec_education01", recordId: "edu_1", values: {} }]
    );
    const draft = normalizeCustomLayout(base, { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW });
    assert.equal(draft.sections[0].fields[0].required, true);
    assert.throws(
      () => normalizeCustomLayout(base, {
        identity: "student",
        recordIds: { education: ["edu_1"] },
        now: NOW,
        enforceRequired: true,
      }),
      (error) => error instanceof ProfileValidationError && /Score is required/.test(error.message)
    );
    assert.throws(
      () => normalizeCustomLayout(educationLayout(
        [field("url", { id: "fld_site000001", label: "Site" })],
        [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_site000001: "javascript:alert(1)" } }]
      ), { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW }),
      (error) => error instanceof ProfileValidationError
    );
    assert.throws(
      () => normalizeCustomLayout(educationLayout(
        [field("number", { id: "fld_score00001", label: "Score", config: { min: 0, max: 10 } })],
        [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_score00001: 11 } }]
      ), { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW }),
      (error) => error instanceof ProfileValidationError
    );
  });
});

describe("custom field security and publishing", () => {
  test("omits private fields from the public snapshot and keeps the draft unchanged", () => {
    const layout = educationLayout(
      [
        field("text", { id: "fld_public0001", label: "Specialization" }),
        field("text", { id: "fld_private001", label: "Roll note", visibility: "private" }),
      ],
      [{
        sectionId: "sec_education01",
        recordId: "edu_1",
        values: { fld_public0001: "Networks", fld_private001: "secret-roll" },
      }]
    );
    const before = JSON.stringify(layout);
    const normalized = normalizeCustomLayout(layout, { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW });
    const published = projectCustomLayout(normalized, { templateId: "magicui-portfolio", assetHref: () => "" });
    assert.equal(JSON.stringify(layout), before);
    assert.equal(published[0].records[0].fields.length, 1);
    assert.equal(published[0].records[0].fields[0].label, "Specialization");
    assert.equal(JSON.stringify(published).includes("secret-roll"), false);
  });

  test("a draft projection does not change an older published snapshot", () => {
    const layout = normalizeCustomLayout(educationLayout(
      [field("text", { id: "fld_public0001", label: "Specialization" })],
      [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_public0001: "Networks" } }]
    ), { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW });
    const live = projectCustomLayout(layout, { templateId: "magicui-portfolio", assetHref: () => "" });
    layout.sections[0].fields[0].label = "Changed only in the draft";
    layout.bindings[0].values.fld_public0001 = "Draft only";
    assert.equal(live[0].records[0].fields[0].label, "Specialization");
    assert.equal(live[0].records[0].fields[0].value, "Networks");
  });

  test("failed required publish leaves the previous snapshot usable", () => {
    const previous = projectCustomLayout(normalizeCustomLayout(educationLayout(
      [field("text", { id: "fld_public0001", label: "Specialization" })],
      [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_public0001: "Networks" } }]
    ), { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW }), { templateId: "magicui-portfolio" });
    assert.throws(() => normalizeCustomLayout(educationLayout(
      [field("text", { id: "fld_public0001", label: "Specialization", required: true })],
      []
    ), { identity: "student", recordIds: { education: ["edu_1"] }, enforceRequired: true, now: NOW }));
    assert.equal(previous[0].records[0].fields[0].value, "Networks");
  });

  test("public DTO filtering drops private custom values and unsafe urls", () => {
    const dto = toPublicProfileDTO({
      preferredName: "Ada",
      education: [{ id: "edu_1", institution: "State", degree: "BSc", currentStatus: "studying" }],
      customLayout: educationLayout(
        [
          field("text", { id: "fld_public0001", label: "Specialization" }),
          field("text", { id: "fld_private001", label: "Private note", visibility: "private" }),
          field("url", { id: "fld_url0000001", label: "Site" }),
        ],
        [{
          sectionId: "sec_education01",
          recordId: "edu_1",
          values: {
            fld_public0001: "<script>alert(1)</script>Networks",
            fld_private001: "secret",
            fld_url0000001: "https://example.edu/lab",
          },
        }]
      ),
    }, { username: "ada", templateId: "magicui-portfolio", identity: "student", recordIds: { education: ["edu_1"] } });
    const serialized = JSON.stringify(dto.customSections);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes("<script>"), false);
    assert.equal(dto.customSections[0].records[0].fields.some((item) => item.value === "https://example.edu/lab"), true);
    const poisoned = allowlistPublicSnapshot({
      ...dto,
      customSections: [{
        id: "sec_education01",
        title: "Education",
        builtinKey: "education",
        repeatable: true,
        records: [{
          id: "edu_1",
          fields: [{
            id: "fld_bad0000001",
            key: "bad",
            label: "Bad",
            type: "url",
            presentation: "link",
            value: "javascript:alert(1)",
          }],
        }],
      }],
    });
    assert.equal(JSON.stringify(poisoned.customSections || []).includes("javascript:"), false);
  });

  test("rejects excessive field counts, huge payloads, stale revisions, and foreign section keys", () => {
    const tooMany = educationLayout(Array.from({ length: 31 }, (_, index) => field("text", {
      id: "fld_" + String(index).padStart(8, "0"),
      label: "Field " + index,
    })));
    assert.throws(
      () => normalizeCustomLayout(tooMany, { identity: "student", recordIds: { education: [] }, now: NOW }),
      (error) => error.status === 400
    );
    const huge = educationLayout([field("textarea", { id: "fld_huge00001", label: "Huge", config: { maxLength: 4000 } })], [
      { sectionId: "sec_education01", recordId: "edu_1", values: { fld_huge00001: "x".repeat(200000) } },
    ]);
    assert.throws(
      () => normalizeCustomLayout(huge, { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW }),
      (error) => error.status === 413
    );
    const current = normalizeCustomLayout(educationLayout([field("text", { id: "fld_public0001", label: "A" })]), {
      identity: "student",
      recordIds: { education: [] },
      now: NOW,
    });
    assert.throws(
      () => normalizeCustomLayout({ ...educationLayout([field("text", { id: "fld_public0001", label: "A" })]), revision: 0 }, {
        identity: "student",
        existing: current,
        recordIds: { education: [] },
        now: NOW,
      }),
      (error) => error.status === 409
    );
    assert.throws(
      () => normalizeCustomLayout(educationLayout([field("text", { id: "fld_public0001", label: "A" })]).sections && {
        schemaVersion: 1,
        revision: 0,
        sections: [{ id: "sec_noedu00001", title: "Education", builtinKey: "education", fields: [] }],
        bindings: [],
        entries: [],
      }, { identity: "freelancer", recordIds: {}, now: NOW }),
      (error) => error instanceof ProfileValidationError && /not a section/.test(error.message)
    );
  });

  test("does not treat a url as an owned asset reference", () => {
    const layout = normalizeCustomLayout(educationLayout(
      [field("image", { id: "fld_image00001", label: "Diagram" })],
      [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_image00001: { assetId: ASSET, fileName: "diagram.png" } } }]
    ), { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW });
    const bindings = collectCustomAssetBindings(layout);
    assert.deepEqual(bindings, [{ assetId: ASSET, purpose: "portfolio-image" }]);
    assert.throws(
      () => normalizeCustomLayout(educationLayout(
        [field("image", { id: "fld_image00001", label: "Diagram" })],
        [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_image00001: { assetId: "https://evil.example/file.png" } } }]
      ), { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW }),
      (error) => error instanceof ProfileValidationError
    );
  });

  test("switching templates does not drop unsupported values", () => {
    const layout = normalizeCustomLayout(educationLayout(
      [field("image", { id: "fld_image00001", label: "Diagram" })],
      [{ sectionId: "sec_education01", recordId: "edu_1", values: { fld_image00001: { assetId: ASSET, fileName: "diagram.png" } } }]
    ), { identity: "student", recordIds: { education: ["edu_1"] }, now: NOW });
    const before = JSON.stringify(layout);
    const hidden = fieldCompatibility("some-other-template", "image");
    const shown = fieldCompatibility("magicui-portfolio", "image");
    assert.equal(hidden.state, "hidden");
    assert.equal(shown.state, "supported");
    assert.equal(JSON.stringify(layout), before);
    const published = projectCustomLayout(layout, {
      templateId: "some-other-template",
      assetHref: () => "/api/assets/public/" + ASSET,
    });
    assert.equal(published[0].records[0].fields[0].presentation, "hidden");
    assert.equal(published[0].records[0].fields[0].value.href, "/api/assets/public/" + ASSET);
  });

  test("all five identities share the engine and only student and professional host education", () => {
    for (const identity of ["student", "professional", "freelancer", "creator", "business"]) {
      const sections = builtinSections(identity);
      assert.ok(sections.length > 0);
      const custom = normalizeCustomLayout({
        schemaVersion: 1,
        revision: 0,
        sections: [{
          id: "sec_custom0001",
          title: "Awards extra",
          builtinKey: null,
          repeatable: true,
          fields: [field("text", { id: "fld_note000001", label: "Note" })],
        }],
        bindings: [],
        entries: [{ id: "ent_one0000001", sectionId: "sec_custom0001", values: { fld_note000001: "Kept" } }],
      }, { identity, recordIds: {}, now: NOW });
      assert.equal(custom.entries[0].values.fld_note000001, "Kept");
    }
    assert.equal(builtinSections("student").some((section) => section.key === "education"), true);
    assert.equal(builtinSections("professional").some((section) => section.key === "education"), true);
    assert.equal(builtinSections("freelancer").some((section) => section.key === "education"), false);
    assert.equal(builtinSections("creator").some((section) => section.key === "education"), false);
    assert.equal(builtinSections("business").some((section) => section.key === "education"), false);
  });
});

describe("record linking and built-in mapping", () => {
  const credentialId = "crd_aws";

  function credentialLayout(fields, bindings, entries) {
    return {
      schemaVersion: 1,
      revision: 0,
      sections: [
        {
          id: "sec_cred000001",
          key: "credentials",
          title: "Credentials",
          builtinKey: "credentials",
          visibility: "public",
          order: 0,
          repeatable: true,
          fields,
        },
      ],
      bindings: bindings || [],
      entries: entries || [],
    };
  }

  test("links an image to the AWS credential without creating another credential", () => {
    const credential = {
      id: credentialId,
      title: "AWS Cloud Practitioner",
      credentialType: "certification",
      issuer: "Amazon Web Services",
      credentialUrl: "https://aws.amazon.com/certification",
    };
    const beforeCredential = JSON.stringify(credential);
    const layout = normalizeCustomLayout(credentialLayout(
      [field("image", { id: "fld_image00001", label: "Certificate image", scope: "record", targetRecordId: credentialId })],
      [{ sectionId: "sec_cred000001", recordId: credentialId, values: { fld_image00001: { assetId: ASSET, fileName: "aws.png" } } }]
    ), { identity: "student", recordIds: { credentials: [credentialId] }, now: NOW });
    assert.equal(layout.sections[0].fields[0].targetRecordId, credentialId);
    assert.equal(layout.sections[0].fields[0].scope, "record");
    assert.equal(layout.sections[0].fields[0].mapsTo, "");
    assert.equal(JSON.stringify(credential), beforeCredential);
    const dto = toPublicProfileDTO({
      preferredName: "Ada",
      credentials: [credential],
      customLayout: layout,
    }, {
      username: "ada",
      templateId: "magicui-portfolio",
      identity: "student",
      recordIds: { credentials: [credentialId] },
    });
    assert.equal(dto.credentials.length, 1);
    assert.equal(dto.credentials[0].id, credentialId);
    assert.equal(dto.credentials[0].title, "AWS Cloud Practitioner");
    assert.equal(dto.credentials[0].credentialUrl, "https://aws.amazon.com/certification");
    const linked = dto.customSections.find((section) => section.builtinKey === "credentials");
    assert.equal(linked.records.length, 1);
    assert.equal(linked.records[0].id, credentialId);
    assert.equal(linked.records[0].fields.length, 1);
    assert.equal(linked.records[0].fields[0].type, "image");
    assert.match(linked.records[0].fields[0].value.href, new RegExp(ASSET));
    assert.equal(dto.customSections.some((section) => !section.builtinKey), false);
    assert.equal(dto.credentials.filter((item) => item.title === "Certificate image").length, 0);
  });

  test("keeps the link when the credential title changes and rejects another user's record id", () => {
    const layout = normalizeCustomLayout(credentialLayout(
      [field("image", { id: "fld_image00001", label: "Certificate image", scope: "record", targetRecordId: credentialId })],
      [{ sectionId: "sec_cred000001", recordId: credentialId, values: { fld_image00001: { assetId: ASSET, fileName: "aws.png" } } }]
    ), { identity: "student", recordIds: { credentials: [credentialId] }, now: NOW });
    const renamed = normalizeCustomLayout({
      ...layout,
      sections: layout.sections.map((section) => ({
        ...section,
        fields: section.fields.map((item) => ({ ...item, label: "Badge image" })),
      })),
    }, {
      identity: "student",
      existing: layout,
      recordIds: { credentials: [credentialId] },
      now: "2026-10-27T01:00:00.000Z",
    });
    assert.equal(renamed.sections[0].fields[0].id, "fld_image00001");
    assert.equal(renamed.sections[0].fields[0].targetRecordId, credentialId);
    assert.equal(renamed.bindings[0].recordId, credentialId);
    assert.throws(
      () => normalizeCustomLayout(credentialLayout(
        [field("image", { id: "fld_image00001", label: "Certificate image", scope: "record", targetRecordId: "crd_other_user" })],
        [{ sectionId: "sec_cred000001", recordId: "crd_other_user", values: { fld_image00001: { assetId: ASSET, fileName: "aws.png" } } }]
      ), { identity: "student", recordIds: { credentials: [credentialId] }, now: NOW }),
      (error) => error instanceof ProfileValidationError && /not on this profile|existing record/.test(error.message)
    );
    assert.throws(
      () => normalizeCustomLayout(credentialLayout(
        [field("text", { id: "fld_note000001", label: "Note", scope: "record", targetRecordId: "crd_$bad" })]
      ), { identity: "student", recordIds: { credentials: [credentialId] }, now: NOW }),
      (error) => error instanceof ProfileValidationError
    );
  });

  test("unlinking keeps the asset and does not copy it onto another credential", () => {
    const otherAsset = "ast_" + "cd".repeat(12);
    const layout = normalizeCustomLayout(credentialLayout(
      [
        field("image", { id: "fld_image00001", label: "Certificate image", scope: "record", targetRecordId: credentialId }),
        field("text", { id: "fld_note000001", label: "Cohort", scope: "section" }),
      ],
      [
        { sectionId: "sec_cred000001", recordId: credentialId, values: { fld_image00001: { assetId: ASSET, fileName: "aws.png" }, fld_note000001: "2026" } },
        { sectionId: "sec_cred000001", recordId: "crd_other", values: { fld_note000001: "Kept", fld_image00001: { assetId: otherAsset, fileName: "other.png" } } },
      ]
    ), { identity: "student", recordIds: { credentials: [credentialId, "crd_other"] }, now: NOW });
    const imageOnOther = layout.bindings.find((item) => item.recordId === "crd_other").values.fld_image00001;
    assert.equal(imageOnOther, undefined);
    const unlinked = normalizeCustomLayout({
      ...layout,
      sections: layout.sections.map((section) => ({
        ...section,
        fields: section.fields.map((item) => item.id === "fld_image00001"
          ? { ...item, scope: "section", targetRecordId: "", mapsTo: "" }
          : item),
      })),
    }, {
      identity: "student",
      existing: layout,
      recordIds: { credentials: [credentialId, "crd_other"] },
      now: "2026-10-27T02:00:00.000Z",
    });
    assert.equal(unlinked.sections[0].fields[0].targetRecordId, "");
    assert.equal(unlinked.bindings.find((item) => item.recordId === credentialId).values.fld_image00001.assetId, ASSET);
    assert.equal(unlinked.bindings.find((item) => item.recordId === "crd_other").values.fld_note000001, "Kept");
    assert.equal(unlinked.bindings.find((item) => item.recordId === "crd_other").values.fld_image00001, undefined);
    assert.deepEqual(collectCustomAssetBindings(unlinked), [{ assetId: ASSET, purpose: "portfolio-image" }]);
  });

  test("maps a compatible url onto an empty credential field and leaves a filled field unchanged", () => {
    const layout = normalizeCustomLayout(credentialLayout(
      [field("url", { id: "fld_url0000001", label: "Badge link", scope: "record", targetRecordId: credentialId, mapsTo: "credentialUrl" })],
      [{ sectionId: "sec_cred000001", recordId: credentialId, values: { fld_url0000001: "https://example.com/badge" } }]
    ), { identity: "student", recordIds: { credentials: [credentialId] }, now: NOW });
    const filled = toPublicProfileDTO({
      preferredName: "Ada",
      credentials: [{ id: credentialId, title: "AWS Cloud Practitioner", credentialType: "certification", issuer: "Amazon", credentialUrl: "https://aws.amazon.com/keep" }],
      customLayout: layout,
    }, { username: "ada", identity: "student", templateId: "magicui-portfolio", recordIds: { credentials: [credentialId] } });
    assert.equal(filled.credentials[0].credentialUrl, "https://aws.amazon.com/keep");
    assert.equal(filled.credentials[0].issuer, "Amazon");
    const empty = toPublicProfileDTO({
      preferredName: "Ada",
      credentials: [{ id: credentialId, title: "AWS Cloud Practitioner", credentialType: "certification", issuer: "Amazon" }],
      customLayout: layout,
    }, { username: "ada", identity: "student", templateId: "magicui-portfolio", recordIds: { credentials: [credentialId] } });
    assert.equal(empty.credentials[0].credentialUrl, "https://example.com/badge");
    assert.equal(empty.credentials[0].issuer, "Amazon");
    assert.throws(
      () => normalizeCustomLayout(credentialLayout([
        field("url", { id: "fld_url0000001", label: "Badge link", mapsTo: "credentialUrl" }),
        field("url", { id: "fld_url0000002", label: "Second link", mapsTo: "credentialUrl" }),
      ]), { identity: "student", recordIds: { credentials: [] }, now: NOW }),
      (error) => error instanceof ProfileValidationError && /Only one custom field can map/.test(error.message)
    );
    assert.throws(
      () => normalizeCustomLayout(credentialLayout(
        [field("image", { id: "fld_image00001", label: "Certificate image", scope: "record", targetRecordId: credentialId, mapsTo: "certificateImage" })]
      ), { identity: "student", recordIds: { credentials: [credentialId] }, now: NOW }),
      (error) => error instanceof ProfileValidationError && /cannot map/.test(error.message)
    );
  });

  test("a removed record keeps its values off every other record, and drafts do not change a published snapshot", () => {
    const layout = normalizeCustomLayout(credentialLayout(
      [field("image", { id: "fld_image00001", label: "Certificate image", scope: "record", targetRecordId: credentialId })],
      [{ sectionId: "sec_cred000001", recordId: credentialId, values: { fld_image00001: { assetId: ASSET, fileName: "aws.png" } } }]
    ), { identity: "student", recordIds: { credentials: [credentialId, "crd_other"] }, now: NOW });
    const orphaned = normalizeCustomLayout(layout, {
      identity: "student",
      existing: layout,
      recordIds: { credentials: ["crd_other"] },
      preserveMissingRecords: true,
      now: "2026-10-27T03:00:00.000Z",
    });
    assert.equal(orphaned.bindings[0].recordId, credentialId);
    assert.equal(orphaned.bindings.some((item) => item.recordId === "crd_other"), false);
    assert.equal(orphaned.sections[0].fields[0].targetRecordId, credentialId);
    const published = projectCustomLayout(layout, {
      templateId: "magicui-portfolio",
      assetHref: (assetId) => "/api/assets/public/" + assetId,
    });
    const live = JSON.parse(JSON.stringify(published));
    layout.bindings[0].values.fld_image00001 = { assetId: "ast_" + "ef".repeat(12), fileName: "draft.png" };
    assert.equal(live[0].records[0].fields[0].value.href, "/api/assets/public/" + ASSET);
    const hidden = toPublicProfileDTO({
      preferredName: "Ada",
      credentials: [{ id: "crd_other", title: "Other", credentialType: "certification", issuer: "Other" }],
      customLayout: orphaned,
    }, { username: "ada", identity: "student", templateId: "magicui-portfolio", recordIds: { credentials: ["crd_other"] } });
    assert.equal(JSON.stringify(hidden.customSections || []).includes(ASSET), false);
    assert.equal(hidden.credentials.length, 1);
    assert.equal(hidden.credentials[0].id, "crd_other");
  });

  test("record links and standalone sections work for every identity", () => {
    for (const identity of ["student", "professional", "freelancer", "creator", "business"]) {
      const section = builtinSections(identity).find((item) => item.repeatable && item.collection);
      assert.ok(section);
      const recordId = "rec_stable_1";
      const linked = normalizeCustomLayout({
        schemaVersion: 1,
        revision: 0,
        sections: [{
          id: "sec_link000001",
          title: section.label,
          builtinKey: section.key,
          repeatable: true,
          fields: [field("text", { id: "fld_link000001", label: "Note", scope: "record", targetRecordId: recordId })],
        }],
        bindings: [{ sectionId: "sec_link000001", recordId, values: { fld_link000001: "Kept" } }],
        entries: [],
      }, { identity, recordIds: { [section.key]: [recordId] }, now: NOW });
      assert.equal(linked.sections[0].fields[0].targetRecordId, recordId);
      const published = projectCustomLayout(linked, { templateId: "magicui-portfolio", assetHref: () => "" });
      assert.equal(published[0].records[0].id, recordId);
      assert.equal(published[0].records[0].fields[0].value, "Kept");
      const standalone = normalizeCustomLayout({
        schemaVersion: 1,
        revision: 0,
        sections: [{
          id: "sec_custom0001",
          title: "Press",
          builtinKey: null,
          repeatable: true,
          fields: [field("text", { id: "fld_note000001", label: "Note" })],
        }],
        bindings: [],
        entries: [{ id: "ent_one0000001", sectionId: "sec_custom0001", values: { fld_note000001: "Independent" } }],
      }, { identity, recordIds: {}, now: NOW });
      assert.equal(standalone.entries[0].values.fld_note000001, "Independent");
      assert.equal(standalone.sections[0].builtinKey, null);
    }
  });

  test("fills empty public fields on employment, links, testimonials, portfolio, and work samples", () => {
    const professional = normalizeCustomLayout({
      schemaVersion: 1,
      revision: 0,
      sections: [
        {
          id: "sec_job0000001",
          key: "current_employment",
          title: "Current employment",
          builtinKey: "currentEmployment",
          visibility: "public",
          order: 0,
          repeatable: false,
          fields: [field("text", { id: "fld_company001", key: "employer", label: "Employer", mapsTo: "company" })],
        },
        {
          id: "sec_hist000001",
          key: "employment_history",
          title: "Employment history",
          builtinKey: "employmentHistory",
          visibility: "public",
          order: 1,
          repeatable: true,
          fields: [field("text", { id: "fld_title00001", key: "role_title", label: "Role", scope: "record", targetRecordId: "job_1", mapsTo: "jobTitle" })],
        },
        {
          id: "sec_port000001",
          key: "portfolio",
          title: "Portfolio",
          builtinKey: "portfolio",
          visibility: "public",
          order: 2,
          repeatable: true,
          fields: [field("url", { id: "fld_url0000001", key: "site", label: "Site", scope: "record", targetRecordId: "proj_1", mapsTo: "url" })],
        },
      ],
      bindings: [
        { sectionId: "sec_job0000001", recordId: "", values: { fld_company001: "Globex" } },
        { sectionId: "sec_hist000001", recordId: "job_1", values: { fld_title00001: "Designer" } },
        { sectionId: "sec_port000001", recordId: "proj_1", values: { fld_url0000001: "https://example.com/work" } },
      ],
      entries: [],
    }, {
      identity: "professional",
      recordIds: { employmentHistory: ["job_1"], portfolio: ["proj_1"] },
      now: NOW,
    });
    const filled = toPublicProfileDTO({
      preferredName: "Ada",
      experience: [
        { id: "currentEmployment", title: "Lead", organization: "" },
        { id: "job_1", title: "", organization: "Initech" },
      ],
      projects: [{ id: "proj_1", title: "Audit" }, { id: "proj_kept", title: "Kept", liveUrl: "https://example.com/kept" }],
      customLayout: professional,
    }, {
      username: "ada",
      identity: "professional",
      templateId: "magicui-portfolio",
      recordIds: { employmentHistory: ["job_1"], portfolio: ["proj_1"] },
    });
    assert.equal(filled.experience[0].organization, "Globex");
    assert.equal(filled.experience[0].title, "Lead");
    assert.equal(filled.experience[1].title, "Designer");
    assert.equal(filled.experience[1].organization, "Initech");
    assert.equal(filled.projects[0].liveUrl, "https://example.com/work");
    assert.equal(filled.projects[1].liveUrl, "https://example.com/kept");
    const kept = toPublicProfileDTO({
      preferredName: "Ada",
      experience: [{ id: "currentEmployment", title: "Lead", organization: "Acme" }],
      projects: [{ id: "proj_1", title: "Audit", liveUrl: "https://example.com/original" }],
      customLayout: professional,
    }, {
      username: "ada",
      identity: "professional",
      templateId: "magicui-portfolio",
      recordIds: { employmentHistory: ["job_1"], portfolio: ["proj_1"] },
    });
    assert.equal(kept.experience[0].organization, "Acme");
    assert.equal(kept.projects[0].liveUrl, "https://example.com/original");

    const links = normalizeCustomLayout({
      schemaVersion: 1,
      revision: 0,
      sections: [{
        id: "sec_link000001",
        key: "links",
        title: "Links",
        builtinKey: "links",
        visibility: "public",
        order: 0,
        repeatable: true,
        fields: [field("text", { id: "fld_user000001", key: "handle", label: "Handle", scope: "record", targetRecordId: "lnk_1", mapsTo: "username" })],
      }],
      bindings: [{ sectionId: "sec_link000001", recordId: "lnk_1", values: { fld_user000001: "ada" } }],
      entries: [],
    }, { identity: "student", recordIds: { links: ["lnk_1"] }, now: NOW });
    const linked = toPublicProfileDTO({
      preferredName: "Ada",
      links: [{ id: "lnk_1", platform: "GitHub", url: "https://github.com/ada", username: "" }],
      customLayout: links,
    }, { username: "ada", identity: "student", templateId: "magicui-portfolio", recordIds: { links: ["lnk_1"] } });
    assert.equal(linked.contact.socialLinks[0].username, "ada");
    assert.equal(linked.contact.socialLinks[0].platform, "GitHub");
    const renamed = toPublicProfileDTO({
      preferredName: "Ada",
      links: [{ id: "lnk_1", platform: "GitHub profile", url: "https://github.com/ada", username: "kept" }],
      customLayout: links,
    }, { username: "ada", identity: "student", templateId: "magicui-portfolio", recordIds: { links: ["lnk_1"] } });
    assert.equal(renamed.contact.socialLinks[0].username, "kept");
    assert.equal(renamed.contact.socialLinks[0].id, "lnk_1");

    const freelancer = normalizeCustomLayout({
      schemaVersion: 1,
      revision: 0,
      sections: [
        {
          id: "sec_quote00001",
          key: "testimonials",
          title: "Testimonials",
          builtinKey: "testimonials",
          visibility: "public",
          order: 0,
          repeatable: true,
          fields: [field("text", { id: "fld_rel0000001", key: "relationship", label: "Relationship", scope: "record", targetRecordId: "t_1", mapsTo: "relationship" })],
        },
        {
          id: "sec_sample0001",
          key: "work_samples",
          title: "Work samples",
          builtinKey: "workSamples",
          visibility: "public",
          order: 1,
          repeatable: true,
          fields: [field("url", { id: "fld_reel000001", key: "reel", label: "Reel", scope: "record", targetRecordId: "sample_1", mapsTo: "url" })],
        },
      ],
      bindings: [
        { sectionId: "sec_quote00001", recordId: "t_1", values: { fld_rel0000001: "Client" } },
        { sectionId: "sec_sample0001", recordId: "sample_1", values: { fld_reel000001: "https://example.com/reel" } },
      ],
      entries: [],
    }, { identity: "freelancer", recordIds: { testimonials: ["t_1"], workSamples: ["sample_1"] }, now: NOW });
    const quote = toPublicProfileDTO({
      preferredName: "Ada",
      testimonials: [{ id: "t_1", quote: "Excellent", authorName: "Mina", relationship: "" }],
      media: [{ id: "sample_1", title: "Reel", mediaUrl: "", mediaType: "link", category: "work-sample" }],
      customLayout: freelancer,
    }, {
      username: "ada",
      identity: "freelancer",
      templateId: "magicui-portfolio",
      recordIds: { testimonials: ["t_1"], workSamples: ["sample_1"] },
    });
    assert.equal(quote.testimonials[0].relationship, "Client");
    assert.equal(quote.media[0].mediaUrl, "https://example.com/reel");

    const creator = normalizeCustomLayout({
      schemaVersion: 1,
      revision: 0,
      sections: [{
        id: "sec_collab0001",
        key: "past_collaborations",
        title: "Past collaborations",
        builtinKey: "pastCollaborations",
        visibility: "public",
        order: 0,
        repeatable: true,
        fields: [field("url", { id: "fld_proof00001", key: "proof", label: "Proof", scope: "record", targetRecordId: "col_1", mapsTo: "url" })],
      }],
      bindings: [{ sectionId: "sec_collab0001", recordId: "col_1", values: { fld_proof00001: "https://example.com/proof" } }],
      entries: [],
    }, { identity: "creator", recordIds: { pastCollaborations: ["col_1"] }, now: NOW });
    const collab = toPublicProfileDTO({
      preferredName: "Ada",
      achievements: [{ id: "col_1", title: "Launch", category: "other", proofUrl: "" }],
      customLayout: creator,
    }, { username: "ada", identity: "creator", templateId: "magicui-portfolio", recordIds: { pastCollaborations: ["col_1"] } });
    assert.equal(collab.achievements[0].proofUrl, "https://example.com/proof");
    assert.equal(collab.achievements[0].title, "Launch");

    assert.throws(
      () => normalizeCustomLayout({
        schemaVersion: 1,
        revision: 0,
        sections: [{
          id: "sec_job0000001",
          key: "current_employment",
          title: "Current employment",
          builtinKey: "currentEmployment",
          visibility: "public",
          order: 0,
          repeatable: false,
          fields: [field("image", { id: "fld_image00001", label: "Office photo", mapsTo: "company" })],
        }],
        bindings: [],
        entries: [],
      }, { identity: "professional", recordIds: {}, now: NOW }),
      (error) => error instanceof ProfileValidationError && /cannot map/.test(error.message)
    );
  });
});

describe("custom field asset ownership", () => {
  test("an asset id that is not owned is rejected by the asset service", { skip: !process.env.MONGODB_URI && !fs.existsSync(path.join(projectRoot, ".env.local")) }, async () => {
    const { loadEnvConfig } = require(path.join(projectRoot, "node_modules", "@next", "env"));
    const { combinedEnv } = loadEnvConfig(projectRoot, true, { info() {}, error() {} });
    const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
    if (!uri) return;
    process.env.MONGODB_URI = uri;
    const mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
    const { assertProfileAssetRefs } = require(path.join(projectRoot, "lib", "storage", "asset-service.ts"));
    if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
    await assert.rejects(
      () => assertProfileAssetRefs("507f1f77bcf86cd799439011", [{ assetId: ASSET, purpose: "portfolio-image" }]),
      (error) => error instanceof ProfileValidationError && error.status === 403
    );
    await mongoose.disconnect();
  });
});
