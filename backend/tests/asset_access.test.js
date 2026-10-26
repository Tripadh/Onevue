/**
 * Authenticated asset upload, ownership, and public delivery.
 * Requires MongoDB from backend/.env.local.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const { loadEnvConfig } = require(path.join(projectRoot, "node_modules", "@next", "env"));
const { combinedEnv } = loadEnvConfig(projectRoot, true, { info() {}, error() {} });
const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
const jwtSecret = combinedEnv.JWT_SECRET || process.env.JWT_SECRET || "fallback_secret";
if (!uri) {
  throw new Error("MONGODB_URI is not set. Define it in backend/.env.local.");
}

process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;
process.env.NODE_ENV = "test";
process.env.PROFILE_PHOTO_STORAGE = "local";

const ts = require(path.join(projectRoot, "node_modules", "typescript"));
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};

const mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));
const bcrypt = require(path.join(projectRoot, "node_modules", "bcryptjs"));

let User;
let StoredAsset;
let ProfessionalProfile;
let PublishedProfileRevision;
let UserWebsiteConfig;
let assetRoute;
let assetItemRoute;
let publicRoute;
let privateRoute;
let professionalRoute;
let storageIndex;

function jpeg() {
  const buf = Buffer.alloc(48);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

function pdf(size = 48) {
  const buf = Buffer.alloc(size);
  buf.write("%PDF-1.4", 0, "ascii");
  return buf;
}

function filePart(buffer, type, name) {
  return {
    size: buffer.length,
    type,
    name,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

describe("asset access control", () => {
  let userA;
  let userB;
  let tokenA;
  let tokenB;
  const createdAssets = [];

  before(async () => {
    await mongoose.connect(uri);
    User = require(path.join(projectRoot, "models", "User.ts")).default;
    StoredAsset = require(path.join(projectRoot, "models", "StoredAsset.ts")).default;
    ProfessionalProfile = require(path.join(projectRoot, "models", "ProfessionalProfile.ts")).default;
    PublishedProfileRevision = require(path.join(projectRoot, "models", "PublishedProfileRevision.ts")).default;
    UserWebsiteConfig = require(path.join(projectRoot, "models", "UserWebsiteConfig.ts")).default;
    assetRoute = require(path.join(projectRoot, "app", "api", "assets", "route.ts"));
    assetItemRoute = require(path.join(projectRoot, "app", "api", "assets", "[assetId]", "route.ts"));
    publicRoute = require(path.join(projectRoot, "app", "api", "assets", "public", "[assetId]", "route.ts"));
    privateRoute = require(path.join(projectRoot, "app", "api", "assets", "private", "[assetId]", "route.ts"));
    professionalRoute = require(path.join(projectRoot, "app", "api", "professional", "profile", "route.ts"));
    storageIndex = require(path.join(projectRoot, "lib", "storage", "index.ts"));

    const password = await bcrypt.hash("AssetSecret123!", 10);
    const stamp = Date.now();
    userA = await User.create({
      name: "Asset Owner",
      email: `asset_owner_${stamp}@example.com`,
      password,
      identity: "professional",
      username: `assetowner${stamp}`,
    });
    userB = await User.create({
      name: "Other Owner",
      email: `asset_other_${stamp}@example.com`,
      password,
      identity: "professional",
      username: `assetother${stamp}`,
    });
    tokenA = jwt.sign({ id: userA._id.toString(), email: userA.email }, jwtSecret);
    tokenB = jwt.sign({ id: userB._id.toString(), email: userB.email }, jwtSecret);
  });

  after(async () => {
    const storage = storageIndex.getObjectStorage();
    const assets = await StoredAsset.find({ ownerId: { $in: [userA._id, userB._id] } });
    for (const asset of assets) {
      try { await storage.deleteObject(asset.objectKey); } catch (_) {}
    }
    await StoredAsset.deleteMany({ ownerId: { $in: [userA._id, userB._id] } });
    await ProfessionalProfile.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    await PublishedProfileRevision.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    await UserWebsiteConfig.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
    await mongoose.disconnect();
  });

  function request(method, token, { jsonBody = null, form = null, url = "http://localhost/api/assets", idempotencyKey = "" } = {}) {
    const headers = new Map();
    if (token) headers.set("authorization", `Bearer ${token}`);
    if (jsonBody) headers.set("content-type", "application/json");
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    return {
      method,
      url,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
      json: async () => jsonBody,
      formData: async () => form,
    };
  }

  async function upload(token, purpose, buffer, type, name, idempotencyKey) {
    const form = { get: (key) => (key === "file" ? filePart(buffer, type, name) : key === "purpose" ? purpose : key === "ownerId" ? userB._id.toString() : null) };
    const res = await assetRoute.POST(request("POST", token, { form, idempotencyKey }));
    const data = await res.json();
    if (data.asset) createdAssets.push(data.asset.assetId);
    return { res, data };
  }

  test("unauthenticated upload, read, and delete are rejected", async () => {
    const uploadRes = await assetRoute.POST(request("POST", null, { form: { get: () => null } }));
    assert.equal(uploadRes.status, 401);
    const readRes = await privateRoute.GET(request("GET", null), { params: { assetId: "ast_" + "a".repeat(24) } });
    assert.equal(readRes.status, 401);
    const deleteRes = await assetItemRoute.DELETE(request("DELETE", null), { params: { assetId: "ast_" + "a".repeat(24) } });
    assert.equal(deleteRes.status, 401);
  });

  test("owner can upload and another user cannot read or delete it", async () => {
    const { res, data } = await upload(tokenA, "resume", pdf(), "application/pdf", "../secret/cv.pdf");
    assert.equal(res.status, 201);
    assert.match(data.asset.assetId, /^ast_[a-f0-9]{24}$/);
    assert.equal(data.asset.objectKey, undefined);
    assert.equal(data.asset.classification, "private");
    assert.equal(data.asset.fileName, "cv.pdf");

    const stored = await StoredAsset.findOne({ assetId: data.asset.assetId });
    assert.equal(String(stored.ownerId), String(userA._id));
    assert.equal(stored.objectKey.includes(".."), false);

    const otherRead = await privateRoute.GET(request("GET", tokenB), { params: { assetId: data.asset.assetId } });
    assert.equal(otherRead.status, 404);
    const otherMeta = await assetItemRoute.GET(request("GET", tokenB), { params: { assetId: data.asset.assetId } });
    assert.equal(otherMeta.status, 404);
    const otherDelete = await assetItemRoute.DELETE(request("DELETE", tokenB), { params: { assetId: data.asset.assetId } });
    assert.equal(otherDelete.status, 404);

    const publicRead = await publicRoute.GET(request("GET", null, { url: `http://localhost/api/assets/public/${data.asset.assetId}` }), {
      params: { assetId: data.asset.assetId },
    });
    assert.equal(publicRead.status, 404);

    const ownRead = await privateRoute.GET(request("GET", tokenA), { params: { assetId: data.asset.assetId } });
    assert.equal(ownRead.status, 200);
    assert.equal(ownRead.headers.get("content-type"), "application/pdf");
    assert.match(ownRead.headers.get("cache-control"), /private, no-store/);
    assert.equal(ownRead.headers.get("x-content-type-options"), "nosniff");
  });

  test("a failed replacement leaves the previous asset readable", async () => {
    const first = await upload(tokenA, "portfolio-image", jpeg(), "image/jpeg", "one.jpg");
    assert.equal(first.res.status, 201);
    const bad = await upload(tokenA, "portfolio-image", Buffer.from("not an image"), "image/jpeg", "bad.jpg");
    assert.equal(bad.res.status, 400);
    const still = await privateRoute.GET(request("GET", tokenA), { params: { assetId: first.data.asset.assetId } });
    assert.equal(still.status, 200);
  });

  test("database save failure removes the new object and keeps the previous asset", async () => {
    const previous = await upload(tokenA, "evidence", pdf(), "application/pdf", "proof.pdf");
    assert.equal(previous.res.status, 201);
    const storage = storageIndex.getObjectStorage();
    const before = await StoredAsset.countDocuments({ ownerId: userA._id });
    const originalCreate = StoredAsset.create;
    StoredAsset.create = async () => {
      throw new Error("database unavailable");
    };
    try {
      const failed = await upload(tokenA, "evidence", pdf(), "application/pdf", "second.pdf");
      assert.equal(failed.res.status, 500);
    } finally {
      StoredAsset.create = originalCreate;
    }
    assert.equal(await StoredAsset.countDocuments({ ownerId: userA._id }), before);
    const readable = await privateRoute.GET(request("GET", tokenA), { params: { assetId: previous.data.asset.assetId } });
    assert.equal(readable.status, 200);
    const objects = await StoredAsset.find({ ownerId: userA._id, status: "verified" });
    for (const asset of objects) {
      assert.ok(await storage.headObject(asset.objectKey));
    }
  });

  test("repeated uploads with the same idempotency key do not create a second object", async () => {
    const key = "idempo-asset-key";
    const first = await upload(tokenA, "certificate", pdf(), "application/pdf", "cert.pdf", key);
    const second = await upload(tokenA, "certificate", pdf(), "application/pdf", "cert.pdf", key);
    assert.equal(first.res.status, 201);
    assert.equal(second.res.status, 201);
    assert.equal(second.data.asset.assetId, first.data.asset.assetId);
    const conflict = await upload(tokenA, "certificate", pdf(80), "application/pdf", "other.pdf", key);
    assert.equal(conflict.res.status, 409);
  });

  test("profiles keep external URLs, old records, and unrelated fields", async () => {
    const image = await upload(tokenA, "portfolio-image", jpeg(), "image/jpeg", "shot.jpg");
    const created = await professionalRoute.PUT(request("PUT", tokenA, {
      jsonBody: {
        headline: "Designer",
        portfolio: [{ id: "port_1", title: "Site", url: "https://example.com/site", assetId: image.data.asset.assetId }],
        resume: { fileName: "cv.pdf", storageKey: "private/resume/cv.pdf" },
      },
    }));
    assert.equal(created.status, 200);
    const partial = await professionalRoute.PUT(request("PUT", tokenA, { jsonBody: { headline: "Updated designer" } }));
    assert.equal(partial.status, 200);
    const saved = await ProfessionalProfile.findOne({ userId: userA._id });
    assert.equal(saved.headline, "Updated designer");
    assert.equal(saved.portfolio[0].url, "https://example.com/site");
    assert.equal(saved.portfolio[0].assetId, image.data.asset.assetId);
    assert.equal(saved.resume.storageKey, "private/resume/cv.pdf");

    const stolen = await professionalRoute.PUT(request("PUT", tokenB, {
      jsonBody: { headline: "Nope", portfolio: [{ title: "Stolen", assetId: image.data.asset.assetId }] },
    }));
    assert.equal(stolen.status, 403);
    const legacyUpdate = await professionalRoute.PUT(request("PUT", tokenB, { jsonBody: { headline: "Legacy still valid" } }));
    assert.equal(legacyUpdate.status, 200);
    const legacy = await ProfessionalProfile.findOne({ userId: userB._id });
    assert.equal(legacy.headline, "Legacy still valid");
    assert.equal((legacy.portfolio || []).length, 0);
    assert.equal(legacy.resume.assetId || "", "");
  });

  test("public delivery requires publication and deletion preserves a live revision", async () => {
    const image = await upload(tokenA, "portfolio-image", jpeg(), "image/png", "pic.png");
    assert.equal(image.res.status, 400);
    const good = await upload(tokenA, "portfolio-image", jpeg(), "image/jpeg", "pic.jpg");
    const assetId = good.data.asset.assetId;
    const unpublished = await publicRoute.GET(request("GET", null), { params: { assetId } });
    assert.equal(unpublished.status, 404);

    const config = await UserWebsiteConfig.create({
      userId: userA._id,
      username: `assetpub${Date.now()}`,
      status: "published",
    });
    await PublishedProfileRevision.create({
      userId: userA._id,
      websiteConfigId: config._id,
      revisionNumber: 1,
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      snapshot: {
        meta: { schemaVersion: "1.0.0" },
        profile: { displayName: "Asset Owner" },
        media: [{ mediaUrl: `/api/assets/public/${assetId}` }],
      },
      checksum: "a".repeat(64),
      publishedAt: new Date(),
      publicAssetIds: [assetId],
    });

    const published = await publicRoute.GET(request("GET", null), { params: { assetId } });
    assert.equal(published.status, 200);
    assert.equal(published.headers.get("content-type"), "image/jpeg");
    assert.match(published.headers.get("cache-control"), /public, max-age=31536000/);
    assert.equal(published.headers.get("x-content-type-options"), "nosniff");

    const blocked = await assetItemRoute.DELETE(request("DELETE", tokenA), { params: { assetId } });
    assert.equal(blocked.status, 409);
    const stillThere = await StoredAsset.findOne({ assetId });
    assert.equal(stillThere.status, "verified");

    await PublishedProfileRevision.deleteMany({ userId: userA._id });
    await ProfessionalProfile.updateOne({ userId: userA._id }, { $set: { portfolio: [] } });
    const removed = await assetItemRoute.DELETE(request("DELETE", tokenA), { params: { assetId } });
    assert.equal(removed.status, 200);
    const again = await assetItemRoute.DELETE(request("DELETE", tokenA), { params: { assetId } });
    assert.equal(again.status, 200);
  });
});
