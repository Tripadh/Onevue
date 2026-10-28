const { test } = require("node:test");
const assert = require("node:assert/strict");
const fields = require("../services/custom-fields.js");

test("renaming a field keeps its id and key", () => {
  const layout = fields.ensureBuiltin(fields.emptyLayout(), { key: "education", label: "Education", repeatable: true });
  const section = fields.sectionByBuiltin(layout, "education");
  const added = fields.addField(layout, section.id, { label: "Research area", type: "text", visibility: "public" });
  assert.equal(added.error, "");
  const created = added.layout.sections[0].fields[0];
  const renamed = fields.updateField(added.layout, section.id, created.id, {
    label: "Thesis topic",
    type: "text",
    visibility: "private",
    helpText: "",
    placeholder: "",
    config: created.config,
  });
  assert.equal(renamed.error, "");
  assert.equal(renamed.layout.sections[0].fields[0].id, created.id);
  assert.equal(renamed.layout.sections[0].fields[0].key, created.key);
  assert.equal(renamed.layout.sections[0].fields[0].label, "Thesis topic");
  assert.equal(renamed.layout.sections[0].fields[0].visibility, "private");
});

test("education records keep separate values and an unknown template hides files", () => {
  let layout = fields.ensureBuiltin(fields.emptyLayout(), { key: "education", label: "Education", repeatable: true });
  const section = fields.sectionByBuiltin(layout, "education");
  layout = fields.addField(layout, section.id, { label: "Accreditation", type: "text" }).layout;
  const field = fields.sectionByBuiltin(layout, "education").fields[0];
  layout = fields.setValue(layout, fields.sectionByBuiltin(layout, "education"), "edu_1", field.id, "NAAC A");
  layout = fields.setValue(layout, fields.sectionByBuiltin(layout, "education"), "edu_2", field.id, "NAAC B");
  const stored = fields.sectionByBuiltin(layout, "education");
  assert.equal(fields.valuesFor(layout, stored, "edu_1")[field.id], "NAAC A");
  assert.equal(fields.valuesFor(layout, stored, "edu_2")[field.id], "NAAC B");
  assert.equal(fields.compatibility("magicui-portfolio", "file").state, "supported");
  assert.equal(fields.compatibility("plain-template", "file").state, "hidden");
  assert.match(fields.compatibility("plain-template", "file").message, /hides this field/);
});

test("an image links to one credential, survives a rename, and unlinking keeps the file", () => {
  let layout = fields.ensureBuiltin(fields.emptyLayout(), { key: "credentials", label: "Credentials", repeatable: true });
  const section = fields.sectionByBuiltin(layout, "credentials");
  const records = [
    { id: "crd_aws", title: "AWS Cloud Practitioner" },
    { id: "crd_other", title: "Other credential" },
  ];
  const added = fields.addField(layout, section.id, {
    label: "Certificate image",
    type: "image",
    scope: "record",
    targetRecordId: "crd_aws",
    mapsTo: "",
    identity: "student",
    records,
  });
  assert.equal(added.error, "");
  const created = added.layout.sections[0].fields[0];
  assert.equal(created.targetRecordId, "crd_aws");
  assert.equal(fields.mappableFields("student", "credentials", "image").length, 0);
  assert.ok(fields.mappableFields("student", "credentials", "url").some((item) => item.key === "credentialUrl"));
  layout = fields.setValue(added.layout, fields.sectionByBuiltin(added.layout, "credentials"), "crd_aws", created.id, { assetId: "ast_aaaaaaaaaaaaaaaaaaaaaaaa", fileName: "aws.png" });
  const renamed = fields.updateField(layout, section.id, created.id, {
    label: "Badge image",
    type: "image",
    scope: "record",
    targetRecordId: "crd_aws",
    mapsTo: "",
    identity: "student",
    records: [{ id: "crd_aws", title: "AWS Certified Cloud Practitioner" }],
    config: created.config,
  });
  assert.equal(renamed.error, "");
  assert.equal(renamed.layout.sections[0].fields[0].id, created.id);
  assert.equal(renamed.layout.sections[0].fields[0].targetRecordId, "crd_aws");
  const moved = fields.setFieldTarget(renamed.layout, section.id, created.id, "crd_other", records);
  assert.equal(moved.error, "");
  assert.equal(moved.layout.sections[0].fields[0].targetRecordId, "crd_other");
  assert.equal(fields.valuesFor(moved.layout, fields.sectionByBuiltin(moved.layout, "credentials"), "crd_other")[created.id].fileName, "aws.png");
  assert.equal(fields.valuesFor(moved.layout, fields.sectionByBuiltin(moved.layout, "credentials"), "crd_aws")[created.id], undefined);
  const unlinked = fields.unlinkField(moved.layout, section.id, created.id);
  assert.equal(unlinked.sections[0].fields[0].targetRecordId, "");
  assert.equal(fields.valuesFor(unlinked, fields.sectionByBuiltin(unlinked, "credentials"), "crd_other")[created.id].assetId, "ast_aaaaaaaaaaaaaaaaaaaaaaaa");
  const fresh = fields.ensureBuiltin(fields.emptyLayout(), { key: "credentials", label: "Credentials", repeatable: true });
  const rejected = fields.addField(fresh, fields.sectionByBuiltin(fresh, "credentials").id, {
    label: "Other image",
    type: "image",
    scope: "record",
    targetRecordId: "crd_foreign",
    identity: "student",
    records,
  });
  assert.match(rejected.error, /not on this profile/);
});

test("a student link keeps its value when the platform name changes", () => {
  const spec = fields.builtinFor("student", "links");
  let layout = fields.ensureBuiltin(fields.emptyLayout(), spec);
  const section = fields.sectionByBuiltin(layout, "links");
  const records = [
    { id: "lnk_1", title: "GitHub" },
    { id: "lnk_2", title: "Site" },
  ];
  const added = fields.addField(layout, section.id, {
    label: "Handle",
    type: "text",
    scope: "record",
    targetRecordId: "lnk_1",
    mapsTo: "username",
    identity: "student",
    records,
  });
  assert.equal(added.error, "");
  const created = added.layout.sections[0].fields[0];
  layout = fields.setValue(added.layout, section, "lnk_1", created.id, "ada");
  const renamed = fields.updateField(layout, section.id, created.id, {
    label: "Public handle",
    type: "text",
    scope: "record",
    targetRecordId: "lnk_1",
    mapsTo: "username",
    identity: "student",
    records: [{ id: "lnk_1", title: "GitHub profile" }, records[1]],
    config: created.config,
  });
  assert.equal(renamed.error, "");
  assert.equal(renamed.layout.sections[0].fields[0].id, created.id);
  assert.equal(fields.valuesFor(renamed.layout, section, "lnk_1")[created.id], "ada");
  assert.ok(fields.mappableFields("student", "links", "text").some((item) => item.key === "username"));
  assert.equal(fields.mappableFields("student", "links", "image").length, 0);
  const unlinked = fields.unlinkField(renamed.layout, section.id, created.id);
  assert.equal(unlinked.sections[0].fields[0].targetRecordId, "");
  assert.equal(fields.valuesFor(unlinked, section, "lnk_1")[created.id], "ada");
});

test("every identity can open a custom section without an education builtin", () => {
  for (const identity of ["student", "professional", "freelancer", "creator", "business"]) {
    const created = fields.addUserSection(fields.emptyLayout(), { title: "Press", description: "Mentions" });
    assert.equal(created.error, "");
    assert.equal(created.layout.sections[0].builtinKey, null);
    assert.equal(fields.builtinFor(identity, "education") ? fields.builtinFor(identity, "education").key : "", identity === "student" || identity === "professional" ? "education" : "");
  }
  assert.equal(fields.validateFieldDraft({ label: "", type: "text" }), "A field label is required.");
  assert.equal(fields.isHttpUrl("javascript:alert(1)"), false);
  assert.equal(fields.isHttpUrl("https://example.com"), true);
});
