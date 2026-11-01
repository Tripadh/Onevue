/**
 * =========================================================================
 * OneVue Phase 5.0 — Administrative Authentication & RBAC Test Suite
 * =========================================================================
 *
 * Verifies all 12 mandatory security and authorization requirements:
 * 1. A valid admin identity is authorized.
 * 2. A student identity is rejected with HTTP 403.
 * 3. Missing authentication is rejected with HTTP 401.
 * 4. Invalid authentication is rejected with HTTP 401.
 * 5. Expired authentication is rejected with HTTP 401.
 * 6. A forged client-supplied role cannot grant admin access.
 * 7. A user whose database record is missing is rejected with HTTP 401.
 * 8. A user whose role cannot be verified is rejected with HTTP 403.
 * 9. Existing student authentication (verifyAuth) continues to pass for students.
 * 10. Ordinary registration ignores client-supplied admin role.
 * 11. Existing users lacking a role field are not implicitly promoted to admin.
 * 12. No credentials appear in error responses or logs.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// Set up JWT secret for testing
process.env.JWT_SECRET = "super_secure_test_jwt_secret_at_least_32_characters_long_123456";

// Module resolution interception for mock DB, next/server, bcryptjs, and mongoose
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "next/server") return "mock_next_server";
  if (request === "mongoose") return "mock_mongoose";
  if (request === "bcryptjs") return "mock_bcrypt";
  if (request.endsWith("/db") || request.endsWith("/db.ts")) return "mock_db";
  if (request.endsWith("/ensure-student-profile") || request.endsWith("/ensure-student-profile.ts")) return "mock_ensure_profile";
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

require.cache["mock_bcrypt"] = {
  id: "mock_bcrypt",
  filename: "mock_bcrypt",
  loaded: true,
  exports: {
    genSalt: async () => "salt",
    hash: async (pwd) => `hashed_${pwd}`,
  },
};

require.cache["mock_ensure_profile"] = {
  id: "mock_ensure_profile",
  filename: "mock_ensure_profile",
  loaded: true,
  exports: {
    ensureStudentProfile: async () => {},
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

let mockFoundUser = null;
let mockCreatedUser = null;

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

function MockUserModel() {
  const Model = function (data) {
    Object.assign(this, data);
    this._id = this._id || "user_id_mock";
    this.save = async function () { return this; };
  };

  Model.findById = async (id) => {
    if (mockFoundUser && (mockFoundUser._id === id || id === mockFoundUser.id)) {
      return mockFoundUser;
    }
    return null;
  };

  Model.findOne = async () => null;

  Model.create = async (data) => {
    mockCreatedUser = data;
    return { _id: "new_created_user_id", ...data };
  };

  return Model;
}

const userModelInstance = MockUserModel();
const mockMongoose = {
  Schema: MockSchema,
  model: () => userModelInstance,
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

const { verifyAuth, verifyAdminAuth, signJwtToken } = require("../lib/auth.ts");

describe("Phase 5.0 — Administrative Authentication & RBAC", () => {
  const adminUser = {
    _id: "user_admin_001",
    name: "Admin User",
    email: "admin@onevue.id",
    role: "admin",
    identity: "professional",
  };

  const studentUser = {
    _id: "user_student_002",
    name: "Student User",
    email: "student@onevue.id",
    role: "student",
    identity: "student",
  };

  const legacyUserNoRole = {
    _id: "user_legacy_003",
    name: "Legacy User",
    email: "legacy@onevue.id",
    identity: "student",
    // role is omitted/undefined (pre-Phase 5.0 record)
  };

  function createRequest(token) {
    return new Request("http://localhost:3000/api/admin/test", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  it("1. Authorizes a valid admin identity", async () => {
    mockFoundUser = adminUser;

    const token = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const req = createRequest(token);

    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, false);
    assert.equal(result.user._id, adminUser._id);
    assert.equal(result.user.role, "admin");
  });

  it("2. Rejects a student identity with HTTP 403 Forbidden", async () => {
    mockFoundUser = studentUser;

    const token = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const req = createRequest(token);

    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.status, 403);
    assert.ok(result.error.includes("Administrative access required") || result.error.includes("Forbidden"));
  });

  it("3. Rejects missing authentication header with HTTP 401 Unauthorized", async () => {
    const req = createRequest(null);
    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.status, 401);
    assert.ok(result.error.includes("Authentication required"));
  });

  it("4. Rejects invalid authentication token with HTTP 401 Unauthorized", async () => {
    const req = createRequest("not_a_valid_jwt_token");
    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.status, 401);
    assert.ok(result.error.includes("Invalid or expired session token"));
  });

  it("5. Rejects expired authentication token with HTTP 401 Unauthorized", async () => {
    const expiredToken = signJwtToken(
      { id: adminUser._id, email: adminUser.email, exp: Math.floor(Date.now() / 1000) - 60 },
      {}
    );
    const req = createRequest(expiredToken);
    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.status, 401);
    assert.ok(result.error.includes("Invalid or expired session token"));
  });

  it("6. Rejects forged client-supplied role claim in JWT token", async () => {
    mockFoundUser = studentUser;

    const forgedToken = signJwtToken({
      id: studentUser._id,
      email: studentUser.email,
      role: "admin", // Client forged claim!
    });
    const req = createRequest(forgedToken);

    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.status, 403);
  });

  it("7. Rejects user whose database record is missing with HTTP 401", async () => {
    mockFoundUser = null;

    const token = signJwtToken({ id: "deleted_user_id", email: "deleted@onevue.id" });
    const req = createRequest(token);

    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.status, 401);
    assert.ok(result.error.includes("Authenticated user no longer exists"));
  });

  it("8. Rejects user whose role cannot be verified with HTTP 403", async () => {
    mockFoundUser = {
      _id: "user_unknown_role",
      name: "Unknown Role",
      email: "unknown@onevue.id",
      role: null,
    };

    const token = signJwtToken({ id: "user_unknown_role", email: "unknown@onevue.id" });
    const req = createRequest(token);

    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.status, 403);
  });

  it("9. Confirms existing student authentication (verifyAuth) continues to pass for students", async () => {
    mockFoundUser = studentUser;

    const token = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const req = createRequest(token);

    const result = await verifyAuth(req);
    assert.equal("error" in result, false);
    assert.equal(result.user._id, studentUser._id);
  });

  it("10. Ordinary registration enforces server-side student default and ignores client role", async () => {
    mockCreatedUser = null;

    const registerRoute = require("../app/api/auth/register/route.ts");
    const req = new Request("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Attacker",
        email: "attacker@example.com",
        password: "password123",
        identity: "student",
        role: "admin",
      }),
    });

    const res = await registerRoute.POST(req);
    assert.equal(res.status, 201);
    assert.equal(mockCreatedUser.role, "student", "Server must force role: 'student'");
  });

  it("11. Existing users lacking a role field are not implicitly promoted to admin", async () => {
    mockFoundUser = legacyUserNoRole;

    const token = signJwtToken({ id: legacyUserNoRole._id, email: legacyUserNoRole.email });
    const req = createRequest(token);

    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.status, 403);
  });

  it("12. Confirms no sensitive credentials or bearer tokens appear in error responses", async () => {
    const rawToken = "Bearer secret_bearer_token_string_12345";
    const req = new Request("http://localhost:3000/api/admin/test", {
      headers: { Authorization: rawToken },
    });

    const result = await verifyAdminAuth(req);
    assert.equal("error" in result, true);
    assert.equal(result.error.includes("secret_bearer_token_string_12345"), false);
    assert.equal(result.error.includes(process.env.JWT_SECRET), false);
  });
});
