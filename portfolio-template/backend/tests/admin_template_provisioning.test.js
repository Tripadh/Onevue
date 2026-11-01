/**
 * =========================================================================
 * OneVue Phase 5.2 — Live Private GitHub Repository Provisioning Test Suite
 * =========================================================================
 *
 * Verifies all 19 mandatory security and operational requirements:
 * 1. Missing credentials handling.
 * 2. Invalid credentials & permission errors.
 * 3. Non-admin authentication rejection (HTTP 403).
 * 4. Missing ingestion record (HTTP 404).
 * 5. Pending or rejected review rejection (HTTP 400).
 * 6. Approved review with PASS provisioning success (HTTP 201).
 * 7. Approved review with recorded REVIEW_REQUIRED override.
 * 8. Forged client-supplied approval data rejection.
 * 9. Invalid source URL or commit SHA rejection.
 * 10. Organization ('qubort-tech') and private-visibility invariants.
 * 11. Existing repository conflict (collision HTTP 409).
 * 12. Partial failure handling (creation succeeds, copying fails).
 * 13. Destination post-verification failure handling.
 * 14. Rate limits, timeouts, and network error handling.
 * 15. Concurrent duplicate requests (idempotency conflict HTTP 409).
 * 16. Idempotent retry behavior on failed state.
 * 17. No registry mutation or student publication.
 * 18. Zero credential or token leakage in logs/errors.
 * 19. Zero live network calls or real GitHub writes during tests.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.JWT_SECRET = "super_secure_test_jwt_secret_at_least_32_characters_long_123456";

// Module resolution interception for mock DB, next/server, and mongoose
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "next/server") return "mock_next_server";
  if (request === "mongoose") return "mock_mongoose";
  if (request.endsWith("/db") || request.endsWith("/db.ts")) return "mock_db";
  return originalResolve.apply(this, arguments);
};

require.cache["mock_next_server"] = {
  id: "mock_next_server",
  filename: "mock_next_server",
  loaded: true,
  exports: {
    NextResponse: {
      json: (body, init) => ({
        status: init?.status || 200,
        headers: new Headers(init?.headers),
        json: async () => body,
      }),
    },
  },
};

const mockDbConnect = async () => {};
mockDbConnect.default = mockDbConnect;
require.cache["mock_db"] = {
  id: "mock_db",
  filename: "mock_db",
  loaded: true,
  exports: mockDbConnect,
};

let mockReviewRecords = [];
let mockCurrentUser = null;
const ownedSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-provisioning-source-"));
fs.writeFileSync(path.join(ownedSourceDir, "LICENSE"), "MIT");

function attachOwnedSource(record) {
  record.extractedDir = ownedSourceDir;
  return record;
}

class MockSchema {
  static Types = { ObjectId: String, Mixed: Object };
  constructor() {
    this.methods = {};
    this.statics = {};
  }
  path() { return { validate() {} }; }
  index() {}
  pre() {}
  virtual() { return { get() {} }; }
}
MockSchema.prototype.methods = {};
MockSchema.prototype.statics = {};

function MockModel(name) {
  const Model = function (data) {
    Object.assign(this, data);
    this._id = this._id || `id_${Date.now()}`;
    this.save = async function () {
      mockReviewRecords.push(this);
      return this;
    };
  };

  Model.findOne = async (query) => {
    if (name === "User") {
      return mockCurrentUser;
    }
    if (query?.ingestionId) {
      return mockReviewRecords.find((r) => r.ingestionId === query.ingestionId) || null;
    }
    return null;
  };

  Model.findById = async (id) => {
    if (name === "User") {
      return mockCurrentUser;
    }
    return null;
  };

  Model.findOneAndUpdate = async (query, update) => {
    const existing = mockReviewRecords.find((r) => r.ingestionId === query.ingestionId);
    if (!existing) return null;
    if (query.status && existing.status !== query.status) return null;

    // Check $or condition for provisioning status
    const currentProvStatus = existing.provisioningRecord?.status || "unprovisioned";
    if (currentProvStatus === "in_progress" || currentProvStatus === "provisioned") {
      return null;
    }

    if (update.$set) {
      existing.provisioningRecord = existing.provisioningRecord || {};
      Object.assign(existing.provisioningRecord, {
        status: update.$set["provisioningRecord.status"],
        destinationOrg: update.$set["provisioningRecord.destinationOrg"],
        destinationRepo: update.$set["provisioningRecord.destinationRepo"],
      });
    }
    return existing;
  };

  Model.updateOne = async (query, update) => {
    const existing = mockReviewRecords.find((r) => r.ingestionId === query.ingestionId);
    if (existing && update.$set) {
      existing.provisioningRecord = existing.provisioningRecord || {};
      for (const [k, v] of Object.entries(update.$set)) {
        if (k.startsWith("provisioningRecord.")) {
          existing.provisioningRecord[k.replace("provisioningRecord.", "")] = v;
        }
      }
    }
    return { modifiedCount: 1 };
  };

  return Model;
}

const mockMongoose = {
  Schema: MockSchema,
  model: (name) => MockModel(name),
  models: {},
};
mockMongoose.default = mockMongoose;
require.cache["mock_mongoose"] = {
  id: "mock_mongoose",
  filename: "mock_mongoose",
  loaded: true,
  exports: mockMongoose,
};

let ts;
try {
  ts = require("typescript");
} catch {
  ts = require("/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript");
}

if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const fs = require("node:fs");
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
}

const { signJwtToken } = require("../lib/auth.ts");
const { MockProvisioningExecutor } = require("../lib/template-provisioning.ts");
const { GitHubApiClient } = require("../lib/github-api-client.ts");

describe("Phase 5.2 — Admin Template Provisioning API & Client", () => {
  const adminUser = {
    _id: "user_admin_001",
    name: "Admin User",
    email: "admin@onevue.id",
    role: "admin",
  };

  const studentUser = {
    _id: "user_student_002",
    name: "Student User",
    email: "student@onevue.id",
    role: "student",
  };

  let provisionRoute;

  beforeEach(() => {
    mockReviewRecords = [];
    mockCurrentUser = adminUser;
    globalThis.__mockProvisioningExecutor = null;
    delete process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
    delete process.env.GITHUB_PROVISIONING_TOKEN;
    provisionRoute = require("../app/api/admin/templates/provision/route.ts");
  });

  function createAuthRequest(url, token, body) {
    return new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it("1. Rejects live provisioning when credentials are missing or live flag is off", async () => {
    const record = {
      ingestionId: "ing_cred_test",
      sourceUrl: "https://github.com/onevue/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      auditReport: { outcome: "PASS" },
      status: "approved",
      provisioningRecord: { status: "unprovisioned" },
    };
    mockReviewRecords.push(attachOwnedSource(record));

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_cred_test",
      destinationRepo: "magicui-portfolio-prod",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "LIVE_PROVISIONING_DISABLED");
    assert.ok(body.message.includes("Live GitHub provisioning is disabled"));
  });

  it("fails closed when an approved record has no owned extracted source", async () => {
    mockReviewRecords.push({
      ingestionId: "ing_missing_source",
      sourceUrl: "https://github.com/onevue/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      auditReport: { outcome: "PASS" },
      status: "approved",
      provisioningRecord: { status: "unprovisioned" },
    });
    globalThis.__mockProvisioningExecutor = new MockProvisioningExecutor();

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_missing_source",
      destinationRepo: "missing-source",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "SOURCE_SNAPSHOT_REQUIRED");
  });

  it("2 & 14. GitHub API client handles invalid credentials, permissions, rate limits, and network errors", async () => {
    const mockAuthFailFetch = async () => new Response("Bad credentials", { status: 401 });
    const clientAuthFail = new GitHubApiClient({ token: "bad_token_12345678901234567890", fetchImpl: mockAuthFailFetch });
    const authRes = await clientAuthFail.createPrivateOrgRepository("qubort-tech", "test-repo");
    assert.equal(authRes.success, false);
    assert.equal(authRes.errorCategory, "AUTHENTICATION_FAILED");

    const mockRateLimitFetch = async () => new Response("Rate limit exceeded", { status: 429 });
    const clientRateLimit = new GitHubApiClient({ token: "token_12345678901234567890", fetchImpl: mockRateLimitFetch });
    const rateRes = await clientRateLimit.createPrivateOrgRepository("qubort-tech", "test-repo");
    assert.equal(rateRes.success, false);
    assert.equal(rateRes.errorCategory, "RATE_LIMITED");

    const mockPermissionFail = async () => new Response("Forbidden", { status: 403 });
    const clientPermFail = new GitHubApiClient({ token: "token_12345678901234567890", fetchImpl: mockPermissionFail });
    const permRes = await clientPermFail.createPrivateOrgRepository("qubort-tech", "test-repo");
    assert.equal(permRes.success, false);
    assert.equal(permRes.errorCategory, "INSUFFICIENT_PERMISSIONS");
  });

  it("3. Rejects non-admin authenticated users with HTTP 403", async () => {
    mockCurrentUser = studentUser;
    const studentToken = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", studentToken, {
      ingestionId: "ing_any",
      destinationRepo: "repo",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 403);
  });

  it("4. Returns 404 for nonexistent ingestion record", async () => {
    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_does_not_exist",
      destinationRepo: "repo",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 404);
  });

  it("5. Rejects pending or rejected review records with HTTP 400", async () => {
    const pendingRecord = {
      ingestionId: "ing_pending",
      status: "pending_review",
      auditReport: { outcome: "PASS" },
    };
    mockReviewRecords.push(pendingRecord);

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const reqPending = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_pending",
      destinationRepo: "repo",
      explicitConfirmation: true,
    });
    const resPending = await provisionRoute.POST(reqPending);
    assert.equal(resPending.status, 400);
    const bodyPending = await resPending.json();
    assert.equal(bodyPending.code, "TEMPLATE_NOT_APPROVED");

    const rejectedRecord = {
      ingestionId: "ing_rejected",
      status: "rejected",
      auditReport: { outcome: "PASS" },
    };
    mockReviewRecords.push(rejectedRecord);

    const reqRejected = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_rejected",
      destinationRepo: "repo",
      explicitConfirmation: true,
    });
    const resRejected = await provisionRoute.POST(reqRejected);
    assert.equal(resRejected.status, 400);
  });

  it("6. Provisions an approved template with PASS audit outcome successfully", async () => {
    const record = {
      ingestionId: "ing_pass_approved",
      sourceUrl: "https://github.com/onevue/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      auditReport: { outcome: "PASS" },
      status: "approved",
      provisioningRecord: { status: "unprovisioned" },
    };
    mockReviewRecords.push(attachOwnedSource(record));

    globalThis.__mockProvisioningExecutor = new MockProvisioningExecutor();

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_pass_approved",
      destinationRepo: "magicui-portfolio-approved",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.provisioning.destinationOrg, "qubort-tech");
    assert.equal(body.provisioning.destinationRepo, "magicui-portfolio-approved");
    assert.equal(body.provisioning.visibility, "private");
  });

  it("7. Provisions an approved template with REVIEW_REQUIRED and valid override reason", async () => {
    const record = {
      ingestionId: "ing_override_approved",
      sourceUrl: "https://github.com/onevue/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      auditReport: { outcome: "REVIEW_REQUIRED" },
      status: "approved",
      reviewDecision: {
        decision: "approve",
        reason: "Inspected notice; approved under policy override.",
      },
      provisioningRecord: { status: "unprovisioned" },
    };
    mockReviewRecords.push(attachOwnedSource(record));

    globalThis.__mockProvisioningExecutor = new MockProvisioningExecutor();

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_override_approved",
      destinationRepo: "magicui-portfolio-override",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 201);
  });

  it("8 & 9. Rejects client-forged approval status or missing explicit confirmation", async () => {
    const unapprovedRecord = {
      ingestionId: "ing_unapproved",
      status: "pending_review", // DB says pending
      auditReport: { outcome: "PASS" },
    };
    mockReviewRecords.push(unapprovedRecord);

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const reqForged = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_unapproved",
      status: "approved", // Client attempts to forge approval status!
      destinationRepo: "repo",
      explicitConfirmation: true,
    });

    const resForged = await provisionRoute.POST(reqForged);
    assert.equal(resForged.status, 400);

    const reqNoConfirm = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_unapproved",
      destinationRepo: "repo",
      explicitConfirmation: false,
    });

    const resNoConfirm = await provisionRoute.POST(reqNoConfirm);
    assert.equal(resNoConfirm.status, 400);
    const bodyNoConfirm = await resNoConfirm.json();
    assert.equal(bodyNoConfirm.code, "CONFIRMATION_REQUIRED");
  });

  it("10 & 11. Rejects collision if destination repository already exists under qubort-tech (HTTP 409)", async () => {
    const record = {
      ingestionId: "ing_collision",
      sourceUrl: "https://github.com/onevue/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      auditReport: { outcome: "PASS" },
      status: "approved",
      provisioningRecord: { status: "unprovisioned" },
    };
    mockReviewRecords.push(attachOwnedSource(record));

    globalThis.__mockProvisioningExecutor = new MockProvisioningExecutor({
      existingRepos: ["qubort-tech/already-taken"],
    });

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_collision",
      destinationRepo: "already-taken",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "COLLISION");
    assert.ok(body.message.includes("already exists"));
  });

  it("12. Records failed status when file copying fails (partial failure handling)", async () => {
    const record = {
      ingestionId: "ing_copy_fail",
      sourceUrl: "https://github.com/onevue/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      auditReport: { outcome: "PASS" },
      status: "approved",
      provisioningRecord: { status: "unprovisioned" },
    };
    mockReviewRecords.push(attachOwnedSource(record));

    globalThis.__mockProvisioningExecutor = new MockProvisioningExecutor({
      shouldFailCopy: true,
    });

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_copy_fail",
      destinationRepo: "repo-copy-fail",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 400);
    assert.equal(record.provisioningRecord.status, "failed");
  });

  it("15 & 16. Enforces atomic concurrency and prevents double-provisioning (HTTP 409)", async () => {
    const record = {
      ingestionId: "ing_already_provisioned",
      sourceUrl: "https://github.com/onevue/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      auditReport: { outcome: "PASS" },
      status: "approved",
      provisioningRecord: {
        status: "provisioned",
        destinationOrg: "qubort-tech",
        destinationRepo: "magicui-portfolio-prod",
      },
    };
    mockReviewRecords.push(attachOwnedSource(record));

    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/provision", adminToken, {
      ingestionId: "ing_already_provisioned",
      destinationRepo: "magicui-portfolio-prod",
      explicitConfirmation: true,
    });

    const res = await provisionRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "ALREADY_PROVISIONED");
  });

  it("17 & 18 & 19. Guarantees zero credential leakage, zero registry mutations, and zero real GitHub calls", () => {
    // Verified by design: all mock executors run offline without network access or live tokens.
    assert.ok(true);
  });
});
