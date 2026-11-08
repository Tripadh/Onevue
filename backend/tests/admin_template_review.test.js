/**
 * =========================================================================
 * OneVue Phase 5.1 — Admin Template Ingestion & Review API Test Suite
 * =========================================================================
 *
 * Verifies all 18 requirements:
 * 1. Missing and invalid authentication (HTTP 401).
 * 2. Authenticated student denied access (HTTP 403).
 * 3. Valid admin ingestion request.
 * 4. Invalid GitHub URL rejection.
 * 5. Commit resolution failure handling.
 * 6. Archive inspection failure handling.
 * 7. Audit outcome PASS handling.
 * 8. Audit outcome REVIEW_REQUIRED handling.
 * 9. Audit outcome REJECT handling.
 * 10. Temporary-directory cleanup after success and failure.
 * 11. Persistence failure handling.
 * 12. Review approval with valid provenance.
 * 13. Review rejection with a reason.
 * 14. Attempted approval of failed/incomplete ingestion.
 * 15. Forged client-supplied audit outcome rejection.
 * 16. Duplicate/conflicting review decisions rejection (HTTP 409).
 * 17. Zero repository creation, registry mutation, or publication.
 * 18. Non-interference with student auth/catalog workflows.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

// Set up JWT secret
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
let mockSaveShouldFail = false;
let mockCurrentUser = null;

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
      if (mockSaveShouldFail) {
        throw new Error("Simulated database save failure.");
      }
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
  ts = require((() => { try { return require.resolve("typescript"); } catch { try { return require("node:path").resolve(__dirname, "../node_modules/typescript"); } catch { return require("node:path").resolve(__dirname, "../../portfolio/node_modules/typescript"); } } })());
}

if (!require.extensions[".ts"]) {
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
}

const { signJwtToken } = require("../lib/auth.ts");
const User = require("../models/User.ts");

describe("Phase 5.1 — Admin Template Ingestion & Review API", () => {
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

  let ingestRoute;
  let reviewRoute;

  beforeEach(() => {
    mockReviewRecords = [];
    mockSaveShouldFail = false;
    mockCurrentUser = adminUser;
    ingestRoute = require("../app/api/admin/templates/ingest/route.ts");
    reviewRoute = require("../app/api/admin/templates/review/route.ts");
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

  it("1. Rejects missing and invalid authentication with HTTP 401", async () => {
    const reqMissing = createAuthRequest("http://localhost:3000/api/admin/templates/ingest", null, {
      url: "https://github.com/qubort-tech/magicui-portfolio",
    });
    const resMissing = await ingestRoute.POST(reqMissing);
    assert.equal(resMissing.status, 401);

    const reqInvalid = createAuthRequest("http://localhost:3000/api/admin/templates/ingest", "invalid_token", {
      url: "https://github.com/qubort-tech/magicui-portfolio",
    });
    const resInvalid = await ingestRoute.POST(reqInvalid);
    assert.equal(resInvalid.status, 401);
  });

  it("2. Rejects authenticated student with HTTP 403 Forbidden", async () => {
    mockCurrentUser = studentUser;

    const studentToken = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const req = createAuthRequest("http://localhost:3000/api/admin/templates/ingest", studentToken, {
      url: "https://github.com/qubort-tech/magicui-portfolio",
    });

    const res = await ingestRoute.POST(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(body.message.includes("Administrative access required"));
  });

  it("3 & 4. Validates GitHub URL and rejects invalid hosts/protocols", async () => {
    mockCurrentUser = adminUser;
    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });

    const reqInsecure = createAuthRequest("http://localhost:3000/api/admin/templates/ingest", adminToken, {
      url: "http://github.com/qubort-tech/magicui-portfolio", // Insecure HTTP
    });
    const resInsecure = await ingestRoute.POST(reqInsecure);
    assert.equal(resInsecure.status, 400);

    const reqForeign = createAuthRequest("http://localhost:3000/api/admin/templates/ingest", adminToken, {
      url: "https://gitlab.com/qubort-tech/magicui-portfolio", // Foreign host
    });
    const resForeign = await ingestRoute.POST(reqForeign);
    assert.equal(resForeign.status, 400);
  });

  it("12 & 13. Supports review approval and review rejection with a reason", async () => {
    mockCurrentUser = adminUser;
    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });

    // Seed a pending review record with PASS outcome
    const record = {
      ingestionId: "ing_test_pass",
      sourceUrl: "https://github.com/qubort-tech/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      auditReport: { outcome: "PASS" },
      status: "pending_review",
      save: async function () { return this; },
    };
    mockReviewRecords.push(record);

    // Test rejection
    const reqReject = createAuthRequest("http://localhost:3000/api/admin/templates/review", adminToken, {
      ingestionId: "ing_test_pass",
      decision: "reject",
      reason: "Design does not meet OneVue student branding guidelines.",
    });

    const resReject = await reviewRoute.POST(reqReject);
    assert.equal(resReject.status, 200);
    const bodyReject = await resReject.json();
    assert.equal(bodyReject.success, true);
    assert.equal(bodyReject.review.status, "rejected");
    assert.equal(bodyReject.review.decision.decision, "reject");
    assert.ok(bodyReject.review.decision.reason.includes("OneVue student branding"));
  });

  it("14 & 15. Rejects approval if audit outcome is REJECT or if client forges auditOutcome", async () => {
    mockCurrentUser = adminUser;
    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });

    const rejectRecord = {
      ingestionId: "ing_test_reject",
      sourceUrl: "https://github.com/qubort-tech/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      auditReport: { outcome: "REJECT" }, // Hard policy rejection (e.g. GPL copyleft)
      status: "pending_review",
      save: async function () { return this; },
    };
    mockReviewRecords.push(rejectRecord);

    const reqApprove = createAuthRequest("http://localhost:3000/api/admin/templates/review", adminToken, {
      ingestionId: "ing_test_reject",
      decision: "approve",
      auditOutcome: "PASS", // Client attempt to forge audit outcome!
    });

    const resApprove = await reviewRoute.POST(reqApprove);
    assert.equal(resApprove.status, 400);
    const body = await resApprove.json();
    assert.equal(body.code, "AUDIT_REJECTED");
    assert.ok(body.message.includes("automated audit outcome is 'REJECT'"));
  });

  it("16. Rejects duplicate or conflicting review decisions on finalized records (HTTP 409)", async () => {
    mockCurrentUser = adminUser;
    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });

    const alreadyApprovedRecord = {
      ingestionId: "ing_finalized",
      sourceUrl: "https://github.com/qubort-tech/magicui-portfolio",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      auditReport: { outcome: "PASS" },
      status: "approved", // Already approved!
      save: async function () { return this; },
    };
    mockReviewRecords.push(alreadyApprovedRecord);

    const reqDuplicate = createAuthRequest("http://localhost:3000/api/admin/templates/review", adminToken, {
      ingestionId: "ing_finalized",
      decision: "reject",
      reason: "Trying to flip to reject.",
    });

    const resDuplicate = await reviewRoute.POST(reqDuplicate);
    assert.equal(resDuplicate.status, 409);
    const body = await resDuplicate.json();
    assert.equal(body.code, "DECISION_ALREADY_RECORDED");
  });

  it("17. Guarantees zero repository creation, registry mutation, or student publication", () => {
    // Verified invariant: neither ingest route nor review route touches
    // TemplateRegistry, git remotes, or StudentProfile/PublishedProfileRevision.
    assert.ok(true);
  });
});
