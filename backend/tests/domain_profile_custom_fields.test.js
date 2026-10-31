/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

const { buildDomainUpdate } = require(path.join(__dirname, "..", "lib", "domain-profile", "validate.ts"));
const contracts = require(path.join(__dirname, "..", "lib", "domain-profile", "contracts.ts"));

const customFields = [{
  id: "fld_extra",
  label: "Supporting note",
  type: "text",
  visibility: "public",
  order: 0,
  value: "Included with the record",
}];

test("domain profile API validation accepts custom fields on records and objects", () => {
  const cases = [
    {
      identity: "professional",
      collection: "certifications",
      record: { id: "cert_one", title: "Cloud certification", issuer: "Example", customFields },
      object: "currentEmployment",
    },
    {
      identity: "freelancer",
      collection: "services",
      record: {
        id: "service_one",
        name: "Consulting",
        customFields,
        packages: [{ id: "package_one", name: "Review", customFields }],
      },
      object: "contact",
    },
    {
      identity: "creator",
      collection: "channels",
      record: { id: "channel_one", platform: "Video", url: "https://example.com", customFields },
      object: "mediaKit",
    },
    {
      identity: "business",
      collection: "products",
      record: { id: "product_one", name: "Widget", customFields },
      object: "branding",
    },
  ];

  for (const item of cases) {
    const collectionUpdate = buildDomainUpdate(
      {},
      { [item.collection]: [item.record] },
      contracts[`${item.identity}Contract`],
      "owner_one"
    );
    assert.deepEqual(collectionUpdate[item.collection][0].customFields, customFields, item.identity);
    if (item.identity === "freelancer") {
      assert.deepEqual(collectionUpdate.services[0].packages[0].customFields, customFields);
    }

    const objectUpdate = buildDomainUpdate(
      {},
      { [item.object]: { customFields } },
      contracts[`${item.identity}Contract`],
      "owner_one"
    );
    assert.deepEqual(objectUpdate[`${item.object}.customFields`], customFields, item.identity);
  }
});

test("domain profile records keep stable ids and omitted values on later saves", () => {
  const contract = contracts.professionalContract;
  const storedObjectId = "66112233445566778899aabb";
  const existing = {
    certifications: [{
      _id: storedObjectId,
      id: "cert_one",
      title: "Cloud certification",
      issuer: "Example",
      issueDate: "2024-01-01",
      customFields,
    }],
  };

  const updated = buildDomainUpdate(
    existing,
    { certifications: [{ id: "cert_one", title: "Cloud certification v2" }] },
    contract,
    "owner_one"
  );
  const record = updated.certifications[0];
  assert.equal(String(record._id), storedObjectId);
  assert.equal(record.id, "cert_one");
  assert.equal(record.title, "Cloud certification v2");
  assert.equal(record.issuer, "Example");
  assert.equal(record.issueDate, "2024-01-01");
  assert.deepEqual(record.customFields, customFields);

  const created = buildDomainUpdate(
    { certifications: [] },
    { certifications: [{ title: "New certification", issuer: "Example" }] },
    contract,
    "owner_one"
  ).certifications[0];
  assert.ok(String(created._id));
  assert.equal(created.id, String(created._id));

  const resent = buildDomainUpdate(
    { certifications: [created] },
    { certifications: [{ id: created.id, title: "New certification v2" }] },
    contract,
    "owner_one"
  ).certifications[0];
  assert.equal(String(resent._id), String(created._id));
  assert.equal(resent.id, created.id);
  assert.equal(resent.title, "New certification v2");
  assert.equal(resent.issuer, "Example");
});
