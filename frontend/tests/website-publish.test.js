const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "components", "dashboard", "student", "StudentWebsitePage.jsx"),
  "utf8"
);
const start = source.indexOf("const handleConfirmPublish");
const end = source.indexOf("const handleConfirmRollback", start);
const publishHandler = source.slice(start, end);
const configIndex = publishHandler.indexOf("/student/website/config");
const publishIndex = publishHandler.indexOf("/student/website/publish");
const between = publishHandler.slice(configIndex, publishIndex);

test("publishing persists the current customization before creating the revision", () => {
  assert.ok(start > -1 && end > start, "publish handler must exist");
  assert.ok(configIndex > -1 && publishIndex > -1, "publish handler must save config then publish");
  assert.ok(configIndex < publishIndex, "config save must run before the publish request");
  assert.match(between, /customization:\s*\{/);
  assert.match(between, /visibleSections/);
  assert.match(between, /sectionOrder/);
});

test("a failed customization save prevents publication", () => {
  assert.match(between, /if \(!configRes\.ok\)[\s\S]*?return;/);
  assert.match(between, /setPublishing\(false\)/);
});

test("identity copy, defaults, and readiness come from the website contract", () => {
  assert.match(source, /\/website\/contract\?identity=/);
  assert.match(source, /contractData\.defaultSections/);
  assert.match(source, /sections=\{customizableSections\}/);
  assert.match(source, /previewData\.summary\.draft/);
  assert.match(source, /inActiveRevision/);
  assert.doesNotMatch(source, /Edit Student Identity/);
  assert.doesNotMatch(source, /developer & student portfolio/);
  assert.doesNotMatch(source, /Projects & Skills/);
  assert.doesNotMatch(source, /of 7 Enabled/);
});

test("section choices are filtered to the contract before persisting", () => {
  assert.match(source, /visibleSections:\s*sanitizeSectionIds\(visibleSections\)/);
  assert.match(source, /sectionOrder:\s*sanitizeSectionIds\(sectionOrder\)/);
  assert.ok(
    source.split("sanitizeSectionIds(visibleSections)").length >= 4,
    "claim, save, publish, and preview must use the contract-filtered sections"
  );
});
