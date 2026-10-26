/**
 * Object storage provider, validation, and publication safety.
 * These checks do not need MongoDB.
 */

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const projectRoot = path.resolve(__dirname, "..");
process.env.NODE_ENV = "test";
process.env.PROFILE_PHOTO_STORAGE = "local";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret_for_storage";

const ts = require(path.join(projectRoot, "node_modules", "typescript"));
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};

const validation = require(path.join(projectRoot, "lib", "storage", "validation.ts"));
const keys = require(path.join(projectRoot, "lib", "storage", "keys.ts"));
const localStorage = require(path.join(projectRoot, "lib", "storage", "local-storage.ts"));
const r2Storage = require(path.join(projectRoot, "lib", "storage", "r2-storage.ts"));
const storageIndex = require(path.join(projectRoot, "lib", "storage", "index.ts"));
const websiteSource = require(path.join(projectRoot, "lib", "domain-profile", "website-source.ts"));
const contracts = require(path.join(projectRoot, "lib", "domain-profile", "contracts.ts"));
const validate = require(path.join(projectRoot, "lib", "domain-profile", "validate.ts"));
const assetService = require(path.join(projectRoot, "lib", "storage", "asset-service.ts"));

function jpeg(size = 32) {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

function pdf(size = 32) {
  const buf = Buffer.alloc(size);
  buf.write("%PDF-1.4", 0, "ascii");
  return buf;
}

describe("object storage provider", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-objects-"));

  after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("local mode is selected without R2 credentials", () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    delete process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    delete process.env.CLOUDFLARE_R2_BUCKET_NAME;
    process.env.PROFILE_PHOTO_STORAGE = "local";
    process.env.NODE_ENV = "test";
    const storage = storageIndex.getObjectStorage();
    assert.equal(storage.providerName, "local");
    assert.equal(storageIndex.getProfilePhotoStorage().providerName, "local");
  });

  test("production refuses local storage", () => {
    process.env.NODE_ENV = "production";
    process.env.PROFILE_PHOTO_STORAGE = "local";
    assert.throws(() => storageIndex.getProfilePhotoStorage(), /production storage requires/i);
    process.env.NODE_ENV = "test";
    process.env.PROFILE_PHOTO_STORAGE = "local";
  });

  test("R2 configuration fails clearly when required variables are missing", () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    delete process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    delete process.env.CLOUDFLARE_R2_BUCKET_NAME;
    assert.throws(
      () => new r2Storage.R2StorageProvider(),
      /Cloudflare R2 is configured as the active storage provider.*missing/i
    );
  });

  test("object keys are generated and traversal is rejected", () => {
    const owner = "a".repeat(24);
    const assetId = "ast_" + "b".repeat(24);
    const key = keys.buildObjectKey("portfolio-image", owner, assetId, "jpg");
    assert.equal(key, `portfolio-image/${owner}/${assetId}.jpg`);
    assert.throws(() => keys.buildObjectKey("../etc", owner, assetId, "jpg"), /purpose/i);
    assert.throws(() => keys.buildObjectKey("resume", owner, assetId, "../pdf"), /extension/i);
    assert.throws(() => keys.assertSafeObjectKey(`${key}/../../secret`), /invalid object key/i);
    const provider = new localStorage.LocalStorageProvider(path.join(tempRoot, "photos"));
    assert.throws(() => provider.sanitizeKey("../escaped.jpg"), /traversal/i);
    assert.throws(() => provider.sanitizeKey("folder/file.png"), /traversal/i);
  });

  test("local upload, read, head, and delete stay inside the object root", async () => {
    const provider = new localStorage.LocalStorageProvider(
      path.join(tempRoot, "photos"),
      path.join(tempRoot, "objects")
    );
    const owner = "c".repeat(24);
    const assetId = "ast_" + "d".repeat(24);
    const key = keys.buildObjectKey("resume", owner, assetId, "pdf");
    const body = pdf(64);
    await provider.putObject({ key, body, contentType: "application/pdf" });
    const head = await provider.headObject(key);
    assert.equal(head.size, 64);
    assert.equal(head.contentType, "application/pdf");
    const read = await provider.getObject(key);
    assert.equal(read.buffer.length, 64);
    assert.equal(await provider.deleteObject(key), true);
    assert.equal(await provider.getObject(key), null);
    assert.equal(await provider.deleteObject(key), false);
  });

  test("validation follows the asset purpose", () => {
    const image = validation.validateAssetContent(jpeg(), "portfolio-image", "image/jpeg");
    assert.equal(image.valid, true);
    assert.equal(image.mimeType, "image/jpeg");

    const spoofed = validation.validateAssetContent(jpeg(), "portfolio-image", "image/png");
    assert.equal(spoofed.valid, false);

    const resume = validation.validateAssetContent(pdf(), "resume", "application/pdf");
    assert.equal(resume.valid, true);
    const resumeImage = validation.validateAssetContent(jpeg(), "resume", "image/jpeg");
    assert.equal(resumeImage.valid, false);

    const empty = validation.validateAssetContent(Buffer.alloc(0), "evidence");
    assert.equal(empty.valid, false);
    const huge = Buffer.alloc(2 * 1024 * 1024 + 10);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    const oversized = validation.validateProfilePhotoImage(huge, "image/jpeg");
    assert.equal(oversized.valid, false);
  });

  test("published mappings keep external URLs and hide private asset ids", () => {
    const owner = "e".repeat(24);
    const publicId = "ast_" + "a".repeat(24);
    const privateId = "ast_" + "b".repeat(24);
    const evidenceId = "ast_" + "c".repeat(24);
    const source = websiteSource.domainProfileToPublicSource("professional", {
      userId: owner,
      headline: "Engineer",
      portfolio: [{ title: "Launch", url: "https://example.com/launch", assetId: publicId }],
      resume: { storageKey: "resume/secret/cv.pdf", assetId: privateId, fileName: "cv.pdf" },
      achievements: [{ title: "Award", evidenceUrl: "https://example.com/proof", assetId: evidenceId }],
    }, { mode: "publish", ownerId: owner });
    const dump = JSON.stringify(source);
    assert.equal(dump.includes(`/api/assets/public/${publicId}`), true);
    assert.equal(dump.includes("https://example.com/launch"), true);
    assert.equal(dump.includes("https://example.com/proof"), true);
    assert.equal(dump.includes(privateId), false);
    assert.equal(dump.includes(evidenceId), false);
    assert.equal(dump.includes("resume/secret"), false);
    assert.equal(dump.includes("/api/assets/private/"), false);

    const preview = websiteSource.domainProfileToPublicSource("professional", {
      userId: owner,
      portfolio: [{ title: "Launch", assetId: publicId }],
    }, { mode: "preview", ownerId: owner });
    const previewDump = JSON.stringify(preview);
    assert.match(previewDump, new RegExp(`/api/assets/private/${publicId}\\?exp=\\d+&sig=[a-f0-9]{64}`));
  });

  test("every identity contract accepts an uploaded asset without dropping other fields", () => {
    const owner = "f".repeat(24);
    const assetId = "ast_" + "1".repeat(24);
    const cases = [
      [contracts.professionalContract, { headline: "Keep", resume: { assetId, fileName: "cv.pdf" } }, "resume"],
      [contracts.freelancerContract, { headline: "Keep", portfolio: [{ title: "Case", assetId }] }, "portfolio-image"],
      [contracts.creatorContract, { featuredContent: [{ title: "Film", url: "https://example.com/v", assetId }] }, "portfolio-image"],
      [contracts.businessContract, { products: [{ name: "Plan", assetId }], registration: { legalName: "Northwind" } }, "portfolio-image"],
    ];
    for (const [contract, body, purpose] of cases) {
      const set = validate.buildDomainUpdate({ headline: "Old" }, body, contract, owner);
      const bindings = assetService.collectAssetBindings(set);
      assert.equal(bindings[0].purpose, purpose);
      assert.equal(bindings[0].assetId, assetId);
      if (body.headline) assert.equal(set.headline, "Keep");
    }
    const partial = validate.buildDomainUpdate(
      { headline: "Old", resume: { assetId, fileName: "cv.pdf", storageKey: "private/resume/cv.pdf" } },
      { headline: "New" },
      contracts.professionalContract,
      owner
    );
    assert.equal(partial.headline, "New");
    assert.equal(partial.resume, undefined);
    assert.throws(
      () => validate.buildDomainUpdate({ resume: { assetId: "../secret" } }, { resume: { assetId: "../secret" } }, contracts.professionalContract, owner),
      /asset reference/i
    );
  });
});
