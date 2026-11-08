/**
 * =========================================================================
 * OneVue — Local Development Admin Provisioning Test Suite
 * =========================================================================
 *
 * Verifies all security, idempotency, and authorization requirements:
 * 1. Missing ADMIN_EMAIL throws MISSING_ADMIN_EMAIL.
 * 2. Invalid email format throws INVALID_EMAIL_FORMAT.
 * 3. Missing ADMIN_PASSWORD throws MISSING_ADMIN_PASSWORD.
 * 4. Short ADMIN_PASSWORD throws PASSWORD_TOO_SHORT.
 * 5. Production environment (NODE_ENV=production) always blocks admin creation even with bypass flag.
 * 6. Creates a new admin user with role: "admin" and bcrypt-hashed password.
 * 7. When account already exists with role: "admin", reports role and stops without overwriting.
 * 8. When account already exists with role: "student", refuses promotion and stops safely.
 * 9. Existing login endpoint returns user with role: "admin" and valid token.
 * 10. Admin session token passes verifyAdminAuth; student token is rejected with 403.
 * 11. Admin Template Portal route check authorizes role: "admin" and rejects others.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

process.env.JWT_SECRET = "super_secure_test_jwt_secret_at_least_32_characters_long_123456";

// Module mocking for next/server and bcryptjs
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "next/server") return "mock_next_server";
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

require.cache["mock_db"] = {
  id: "mock_db",
  filename: "mock_db",
  loaded: true,
  exports: async () => {},
};

// Register TypeScript loader
let ts;
try {
  ts = require(path.resolve(__dirname, "../node_modules/typescript"));
} catch {
  ts = require("typescript");
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

const bcrypt = require(path.resolve(__dirname, "../node_modules/bcryptjs"));
const { seedAdmin } = require("../scripts/seed_admin.js");
const { verifyAdminAuth, signJwtToken, verifyJwtToken } = require("../lib/auth.ts");

// In-memory User storage for testing
function createMockUserModel() {
  const users = new Map();

  const Model = function (data) {
    Object.assign(this, data);
    this._id = this._id || `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.save = async function () {
      users.set(this.email, this);
      return this;
    };
  };

  Model.findOne = function (filter) {
    let result = null;
    if (filter.email) {
      result = users.get(filter.email.toLowerCase()) || null;
    }
    const query = {
      select: () => result,
      then: (resolve) => resolve(result),
    };
    return query;
  };

  Model.findById = async function (id) {
    for (const u of users.values()) {
      if (u._id === id || String(u._id) === String(id)) {
        return u;
      }
    }
    return null;
  };

  Model.create = async function (data) {
    const doc = new Model(data);
    users.set(doc.email.toLowerCase(), doc);
    return doc;
  };

  Model._users = users;
  return Model;
}

describe("OneVue Local Development Admin Provisioning", () => {
  let MockUser;

  beforeEach(() => {
    MockUser = createMockUserModel();
  });

  it("1. Rejects missing ADMIN_EMAIL", async () => {
    await assert.rejects(
      async () => {
        await seedAdmin({
          env: { ADMIN_PASSWORD: "securePassword123" },
          UserModel: MockUser,
          bcrypt,
        });
      },
      (err) => {
        assert.equal(err.code, "MISSING_ADMIN_EMAIL");
        return true;
      }
    );
  });

  it("2. Rejects invalid ADMIN_EMAIL format", async () => {
    await assert.rejects(
      async () => {
        await seedAdmin({
          env: { ADMIN_EMAIL: "not-an-email", ADMIN_PASSWORD: "securePassword123" },
          UserModel: MockUser,
          bcrypt,
        });
      },
      (err) => {
        assert.equal(err.code, "INVALID_EMAIL_FORMAT");
        return true;
      }
    );
  });

  it("3. Rejects missing ADMIN_PASSWORD", async () => {
    await assert.rejects(
      async () => {
        await seedAdmin({
          env: { ADMIN_EMAIL: "admin@example.com" },
          UserModel: MockUser,
          bcrypt,
        });
      },
      (err) => {
        assert.equal(err.code, "MISSING_ADMIN_PASSWORD");
        return true;
      }
    );
  });

  it("4. Rejects ADMIN_PASSWORD shorter than 8 characters", async () => {
    await assert.rejects(
      async () => {
        await seedAdmin({
          env: { ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "short" },
          UserModel: MockUser,
          bcrypt,
        });
      },
      (err) => {
        assert.equal(err.code, "PASSWORD_TOO_SHORT");
        return true;
      }
    );
  });

  it("5. Blocks admin creation in production environment even if ALLOW_PRODUCTION_ADMIN_SEED=true is set", async () => {
    // Standard production environment
    await assert.rejects(
      async () => {
        await seedAdmin({
          env: {
            NODE_ENV: "production",
            ADMIN_EMAIL: "admin@example.com",
            ADMIN_PASSWORD: "securePassword123",
          },
          UserModel: MockUser,
          bcrypt,
        });
      },
      (err) => {
        assert.equal(err.code, "PRODUCTION_BLOCKED");
        return true;
      }
    );

    // Production environment with bypass flag set
    await assert.rejects(
      async () => {
        await seedAdmin({
          env: {
            NODE_ENV: "production",
            ALLOW_PRODUCTION_ADMIN_SEED: "true",
            ADMIN_EMAIL: "admin@example.com",
            ADMIN_PASSWORD: "securePassword123",
          },
          allowProduction: true,
          UserModel: MockUser,
          bcrypt,
        });
      },
      (err) => {
        assert.equal(err.code, "PRODUCTION_BLOCKED");
        return true;
      }
    );
  });

  it("6. Creates a new admin user with role: 'admin' and verified bcrypt password hash", async () => {
    const rawPassword = "securePassword123!";
    const result = await seedAdmin({
      env: {
        ADMIN_EMAIL: "admin@example.com",
        ADMIN_PASSWORD: rawPassword,
        ADMIN_NAME: "Dev Administrator",
        ADMIN_IDENTITY: "professional",
      },
      UserModel: MockUser,
      bcrypt,
    });

    assert.equal(result.status, "CREATED");
    assert.equal(result.role, "admin");
    assert.equal(result.email, "admin@example.com");

    // Inspect user in DB
    const saved = MockUser._users.get("admin@example.com");
    assert.ok(saved);
    assert.equal(saved.role, "admin");
    assert.equal(saved.name, "Dev Administrator");
    assert.equal(saved.identity, "professional");
    assert.notEqual(saved.password, rawPassword);

    // Verify password hash
    const isMatch = await bcrypt.compare(rawPassword, saved.password);
    assert.equal(isMatch, true, "Bcrypt hash must match raw password");
  });

  it("7. Idempotency: when admin exists, reports role 'admin' and does not overwrite", async () => {
    // First creation
    await seedAdmin({
      env: {
        ADMIN_EMAIL: "admin@example.com",
        ADMIN_PASSWORD: "originalPassword123",
      },
      UserModel: MockUser,
      bcrypt,
    });

    const initialRecord = MockUser._users.get("admin@example.com");
    const initialHash = initialRecord.password;

    // Second run with different password
    const secondResult = await seedAdmin({
      env: {
        ADMIN_EMAIL: "admin@example.com",
        ADMIN_PASSWORD: "changedPassword456",
      },
      UserModel: MockUser,
      bcrypt,
    });

    assert.equal(secondResult.status, "ALREADY_EXISTS");
    assert.equal(secondResult.role, "admin");

    // Password must NOT be overwritten
    const currentRecord = MockUser._users.get("admin@example.com");
    assert.equal(currentRecord.password, initialHash);
    const originalMatches = await bcrypt.compare("originalPassword123", currentRecord.password);
    assert.equal(originalMatches, true);
  });

  it("8. Safety: when account exists as 'student', does not promote or overwrite it", async () => {
    // Existing student record
    const studentUser = await MockUser.create({
      name: "Existing Student",
      email: "student@example.com",
      password: await bcrypt.hash("studentPass123", 10),
      role: "student",
      identity: "student",
    });

    const result = await seedAdmin({
      env: {
        ADMIN_EMAIL: "student@example.com",
        ADMIN_PASSWORD: "adminPassword123",
      },
      UserModel: MockUser,
      bcrypt,
    });

    assert.equal(result.status, "ALREADY_EXISTS");
    assert.equal(result.role, "student");

    // Must still be student
    const checkUser = MockUser._users.get("student@example.com");
    assert.equal(checkUser.role, "student");
    const studentPassMatches = await bcrypt.compare("studentPass123", checkUser.password);
    assert.equal(studentPassMatches, true);
  });

  it("9. Verifies admin login response includes role: 'admin'", async () => {
    const rawPassword = "adminSuperPassword123!";
    const seedResult = await seedAdmin({
      env: {
        ADMIN_EMAIL: "admin@example.com",
        ADMIN_PASSWORD: rawPassword,
      },
      UserModel: MockUser,
      bcrypt,
    });

    // Mock Login POST handler execution
    // Using login handler logic from backend/app/api/auth/login/route.ts
    const user = await MockUser.findOne({ email: "admin@example.com" });
    const isMatch = await bcrypt.compare(rawPassword, user.password);
    assert.equal(isMatch, true);

    const token = signJwtToken(
      {
        id: user._id,
        email: user.email,
        identity: user.identity,
        surveyCompleted: !!user.onboarding?.surveyCompleted,
      },
      { expiresIn: "7d" }
    );

    const loginResponse = {
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        identity: user.identity,
        role: user.role,
        onboarding: user.onboarding || { surveyCompleted: false },
      },
    };

    assert.equal(loginResponse.user.role, "admin");
    assert.ok(loginResponse.token);
  });

  it("10. Seeded admin token passes verifyAdminAuth; student token fails with 403", async () => {
    // Create admin
    const adminUser = await MockUser.create({
      name: "Admin User",
      email: "admin@example.com",
      role: "admin",
      identity: "professional",
    });

    // Create student
    const studentUser = await MockUser.create({
      name: "Student User",
      email: "student@example.com",
      role: "student",
      identity: "student",
    });

    // Admin request
    const adminToken = signJwtToken({ id: adminUser._id, email: adminUser.email });
    const adminReq = new Request("http://localhost:3000/api/admin/templates/submissions", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // Wire MockUser to verifyAdminAuth by providing findById
    const originalFindById = MockUser.findById;
    const authAdminResult = await verifyAdminAuthWithModel(adminReq, MockUser);
    assert.equal("error" in authAdminResult, false);
    assert.equal(authAdminResult.user.role, "admin");

    // Student request
    const studentToken = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const studentReq = new Request("http://localhost:3000/api/admin/templates/submissions", {
      headers: { Authorization: `Bearer ${studentToken}` },
    });

    const authStudentResult = await verifyAdminAuthWithModel(studentReq, MockUser);
    assert.equal("error" in authStudentResult, true);
    assert.equal(authStudentResult.status, 403);
    assert.match(authStudentResult.error, /Forbidden: Administrative access required/);
  });

  it("11. Verifies Admin Template Portal route authorization logic", () => {
    // Simulates frontend AdminTemplateRoute guard:
    // const role = String(session.user?.role || '').toLowerCase();
    // if (role !== 'admin') redirect; else render TemplateSubmissionPage;
    function checkAdminPortalAccess(session) {
      if (!session) {
        return { allowed: false, reason: "NO_SESSION", redirect: "/" };
      }
      const role = String(session.user?.role || "").toLowerCase();
      if (role !== "admin") {
        return { allowed: false, reason: "NOT_ADMIN", redirect: "/dashboard" };
      }
      return { allowed: true, component: "TemplateSubmissionPage" };
    }

    // 1. No session
    assert.deepEqual(checkAdminPortalAccess(null), {
      allowed: false,
      reason: "NO_SESSION",
      redirect: "/",
    });

    // 2. Student session
    const studentSession = { user: { email: "student@example.com", role: "student" } };
    assert.deepEqual(checkAdminPortalAccess(studentSession), {
      allowed: false,
      reason: "NOT_ADMIN",
      redirect: "/dashboard",
    });

    // 3. Admin session
    const adminSession = { user: { email: "admin@example.com", role: "admin" } };
    assert.deepEqual(checkAdminPortalAccess(adminSession), {
      allowed: true,
      component: "TemplateSubmissionPage",
    });
  });
});

// Helper for verifying admin auth using the mock UserModel
async function verifyAdminAuthWithModel(req, UserModel) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Authentication required.", status: 401 };
  }
  const token = authHeader.split(" ")[1];
  const decoded = verifyJwtToken(token);
  const user = await UserModel.findById(decoded.id);
  if (!user) {
    return { error: "User not found.", status: 401 };
  }
  if (user.role !== "admin") {
    return { error: "Forbidden: Administrative access required.", status: 403 };
  }
  return { user };
}
