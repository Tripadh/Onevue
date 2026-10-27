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
