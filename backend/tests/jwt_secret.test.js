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

const {
  resolveJwtSecret,
  verifyAuth,
  verifyJwtToken,
  signJwtToken,
} = require(path.join(projectRoot, "lib", "auth.ts"));
const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));

const originalNodeEnv = process.env.NODE_ENV;
const originalSecret = process.env.JWT_SECRET;
const originalIssuer = process.env.JWT_ISSUER;
const originalAudience = process.env.JWT_AUDIENCE;

describe("JWT secret fail-closed", { concurrency: 1 }, () => {
  after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalIssuer === undefined) delete process.env.JWT_ISSUER;
    else process.env.JWT_ISSUER = originalIssuer;
    if (originalAudience === undefined) delete process.env.JWT_AUDIENCE;
    else process.env.JWT_AUDIENCE = originalAudience;
  });

  test("production rejects a missing secret and the insecure fallback", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "fallback_secret";
    assert.throws(() => resolveJwtSecret(), /not configured/);
    process.env.JWT_SECRET = "";
    assert.throws(() => resolveJwtSecret(), /not configured/);
    process.env.JWT_SECRET = "a-real-production-secret-value-32-chars";
    assert.equal(resolveJwtSecret(), "a-real-production-secret-value-32-chars");
  });

  test("all environments require an explicit non-default secret", () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "unit-test-secret-that-is-at-least-32-chars";
    assert.equal(resolveJwtSecret(), "unit-test-secret-that-is-at-least-32-chars");
    delete process.env.JWT_SECRET;
    assert.throws(() => resolveJwtSecret(), /not configured/);
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

  test("production rejects invalid signatures, malformed tokens, and unsupported algorithms", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "unit-test-secret-that-is-at-least-32-chars";
    process.env.JWT_ISSUER = "onevue-api";
    process.env.JWT_AUDIENCE = "onevue-client";

    const valid = signJwtToken({ id: "507f1f77bcf86cd799439011", email: "a@b.co" });
    assert.equal(verifyJwtToken(valid).id, "507f1f77bcf86cd799439011");
    assert.throws(
      () => verifyJwtToken(valid, "different-secret"),
      /not configured/i
    );
    assert.throws(() => verifyJwtToken("not-a-jwt"), /jwt malformed/i);

    const noneToken = [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ id: "507f1f77bcf86cd799439011" })).toString("base64url"),
      "",
    ].join(".");
    assert.throws(() => verifyJwtToken(noneToken), /invalid algorithm|signature is required/i);
  });

  test("production validates issuer and audience", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "unit-test-secret-that-is-at-least-32-chars";
    process.env.JWT_ISSUER = "onevue-api";
    process.env.JWT_AUDIENCE = "onevue-client";

    const wrongIssuer = jwt.sign(
      { id: "507f1f77bcf86cd799439011", email: "a@b.co" },
      "unit-test-secret-that-is-at-least-32-chars",
      { algorithm: "HS256", issuer: "wrong-issuer", audience: "onevue-client" }
    );
    const wrongAudience = jwt.sign(
      { id: "507f1f77bcf86cd799439011", email: "a@b.co" },
      "unit-test-secret-that-is-at-least-32-chars",
      { algorithm: "HS256", issuer: "onevue-api", audience: "wrong-audience" }
    );

    assert.throws(() => verifyJwtToken(wrongIssuer), /issuer/i);
    assert.throws(() => verifyJwtToken(wrongAudience), /audience/i);
  });
});
