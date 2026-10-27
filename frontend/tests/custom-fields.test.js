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
