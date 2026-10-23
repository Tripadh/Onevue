/**
 * Production authentication must fail closed without a real JWT secret.
 * This file does not connect to MongoDB.
 */

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onevue_jwt_secret_test";

const ts = require(path.join(projectRoot, "node_modules", "typescript"));
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};

const { resolveJwtSecret, verifyAuth } = require(path.join(projectRoot, "lib", "auth.ts"));
const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));

const originalNodeEnv = process.env.NODE_ENV;
const originalSecret = process.env.JWT_SECRET;

describe("JWT secret fail-closed", { concurrency: 1 }, () => {
  after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  test("production rejects a missing secret and the insecure fallback", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "fallback_secret";
    assert.throws(() => resolveJwtSecret(), /not configured/);
    process.env.JWT_SECRET = "";
    assert.throws(() => resolveJwtSecret(), /not configured/);
    process.env.JWT_SECRET = "a-real-production-secret-value";
    assert.equal(resolveJwtSecret(), "a-real-production-secret-value");
  });

  test("non-production can use an explicit test secret or the local fallback", () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "unit-test-secret";
    assert.equal(resolveJwtSecret(), "unit-test-secret");
    delete process.env.JWT_SECRET;
    assert.equal(resolveJwtSecret(), "fallback_secret");
  });

  test("production authentication does not accept a token signed with the fallback secret", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "fallback_secret";
    const token = jwt.sign({ id: "507f1f77bcf86cd799439011", email: "a@b.co" }, "fallback_secret");
    const response = await verifyAuth({
      headers: { get: (name) => (name.toLowerCase() === "authorization" ? `Bearer ${token}` : null) },
    });
    assert.equal(response.status, 500);
    assert.match(response.error, /not configured/);
    assert.equal(response.user, undefined);
  });
});
