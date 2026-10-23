/**
 * Platform certificate routes against an ephemeral MongoDB.
 * Does not read or print local environment files.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = path.resolve(__dirname, "..");
const { MongoMemoryServer } = require(path.join(
  projectRoot,
  "certificate-verification",
  "node_modules",
  "mongodb-memory-server",
));

const ts = require(path.join(projectRoot, "node_modules", "typescript"));
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(compiled.outputText, filename);
};

function mockRequest(body, token, rawText) {
  const headers = new Map();
  if (token) headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  return {
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    json: async () => body,
    text: async () => (rawText !== undefined ? rawText : JSON.stringify(body ?? {})),
  };
}

describe("platform certificate routes", () => {
  let memory;
  let mongoose;
  let User;
  let userA;
  let userB;
  let tokenA;
  let tokenB;
  let calls;
  let failNext;
  let authNext;
  let server;
  let submitRoute;
  let readRoute;
  let verifyRoute;
  const jwtSecret = "route-test-secret";
  const badge = "https://www.credly.com/badges/84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
  const certificateId = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";

  before(async () => {
    memory = await MongoMemoryServer.create();
    process.env.MONGODB_URI = memory.getUri();
    process.env.JWT_SECRET = jwtSecret;
    process.env.CERTIFICATE_SERVICE_TOKEN = "route-test-token";
    process.env.CERTIFICATE_SERVICE_TIMEOUT_MS = "2000";

    mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
    const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));
    await mongoose.connect(process.env.MONGODB_URI);
    User = require(path.join(projectRoot, "models", "User.ts")).default;
    const stamp = Date.now();
    userA = await User.create({
      name: `Cert A ${stamp}`,
      email: `cert_a_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    userB = await User.create({
      name: `Cert B ${stamp}`,
      email: `cert_b_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    tokenA = jwt.sign({ id: userA._id.toString(), email: userA.email }, jwtSecret);
    tokenB = jwt.sign({ id: userB._id.toString(), email: userB.email }, jwtSecret);

    calls = [];
    failNext = false;
    authNext = false;
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const user = req.headers["x-onevue-user-id"];
        const authorization = req.headers.authorization;
        calls.push({ url: req.url, method: req.method, user, authorization, body: raw });
        if (failNext) {
          failNext = false;
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "upstream failed" } }));
          return;
        }
        if (authNext) {
          authNext = false;
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({
            error: { code: "UNAUTHORIZED", message: "Service authentication failed." },
          }));
          return;
        }
        if (user !== userA._id.toString()) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Certificate was not found." } }));
          return;
        }
        const certificate = {
          id: certificateId,
          url: badge,
          canonicalUrl: badge,
          issuer: "credly",
          credentialId: certificateId,
          status: "PENDING",
          evidence: null,
          submittedAt: "2026-10-17T00:00:00.000Z",
          verifiedAt: null,
          attempts: 0,
          failureReason: null,
        };
        const created = req.url === "/certificates";
        res.writeHead(created ? 202 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(created ? { created: true, certificate } : { certificate }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.CERTIFICATE_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

    submitRoute = require(path.join(projectRoot, "app", "api", "student", "certificates", "route.ts"));
    readRoute = require(path.join(projectRoot, "app", "api", "student", "certificates", "[id]", "route.ts"));
    verifyRoute = require(path.join(projectRoot, "app", "api", "student", "certificates", "[id]", "verify", "route.ts"));
  });

  after(async () => {
    if (User && userA) await User.deleteOne({ _id: userA._id });
    if (User && userB) await User.deleteOne({ _id: userB._id });
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose) await mongoose.disconnect();
    if (memory) await memory.stop();
  });

  test("rejects unauthenticated submission", async () => {
    const response = await submitRoute.POST(mockRequest({ url: badge }, ""));
    assert.equal(response.status, 401);
  });

  test("does not accept an LLM or status claim as verification", async () => {
    const before = calls.length;
    const response = await submitRoute.POST(
      mockRequest({ url: badge, status: "VERIFIED", llmStatus: "VERIFIED" }, tokenA),
    );
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.message, "Request validation failed.");
    assert.equal(calls.length, before);
  });

  test("submits as the authenticated user and hides the certificate from another user", async () => {
    const submitted = await submitRoute.POST(mockRequest({ url: badge }, tokenA));
    const submittedBody = await submitted.json();
    assert.equal(submitted.status, 202);
    assert.equal(submittedBody.certificate.status, "PENDING");
    assert.equal(submittedBody.certificate.userId, undefined);
    assert.equal(calls.at(-1).user, userA._id.toString());
    assert.deepEqual(JSON.parse(calls.at(-1).body), { url: badge });

    const hidden = await readRoute.GET(mockRequest(null, tokenB), {
      params: Promise.resolve({ id: certificateId }),
    });
    const hiddenBody = await hidden.json();
    assert.equal(hidden.status, 404);
    assert.equal(hiddenBody.message, "Certificate was not found.");
    assert.equal(calls.at(-1).user, userB._id.toString());

    const spoofed = await verifyRoute.POST(
      mockRequest({ status: "VERIFIED" }, tokenA, JSON.stringify({ status: "VERIFIED" })),
      { params: Promise.resolve({ id: certificateId }) },
    );
    assert.equal(spoofed.status, 400);
  });

  test("forwards verification for the owning user and does not promote a pending result", async () => {
    const before = calls.length;
    const response = await verifyRoute.POST(
      mockRequest({}, tokenA, "{}"),
      { params: Promise.resolve({ id: certificateId }) },
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.certificate.status, "PENDING");
    assert.notEqual(body.certificate.status, "VERIFIED");
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).method, "POST");
    assert.equal(calls.at(-1).url, `/certificates/${certificateId}/verify`);
    assert.equal(calls.at(-1).user, userA._id.toString());
    assert.equal(calls.at(-1).authorization, "Bearer route-test-token");
    assert.equal(calls.at(-1).body, "{}");
  });

  test("returns a sanitized authentication error when the service rejects the token", async () => {
    authNext = true;
    const response = await submitRoute.POST(mockRequest({ url: badge }, tokenA));
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.message, "Certificate service authentication failed.");
    assert.notEqual(body.message, "Request validation failed.");
    assert.equal(JSON.stringify(body).includes("route-test-token"), false);
    assert.equal(body.certificate, undefined);
  });

  test("returns unavailable when the certificate service fails", async () => {
    failNext = true;
    const response = await verifyRoute.POST(
      mockRequest({}, tokenA, "{}"),
      { params: Promise.resolve({ id: certificateId }) },
    );
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.message, "Certificate verification is temporarily unavailable.");
    assert.equal(body.certificate, undefined);
  });

  test("rejects a malformed certificate id before calling the service", async () => {
    const before = calls.length;
    const response = await verifyRoute.POST(
      mockRequest({}, tokenA, "{}"),
      { params: Promise.resolve({ id: "not-a-certificate" }) },
    );
    assert.equal(response.status, 400);
    assert.equal(calls.length, before);
  });
});
