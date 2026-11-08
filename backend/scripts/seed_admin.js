#!/usr/bin/env node
/**
 * =========================================================================
 * OneVue — Local Development Admin Provisioning Script
 * =========================================================================
 *
 * Usage:
 *   ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="your-secure-password" node backend/scripts/seed_admin.js
 *
 * Optional environment variables:
 *   ADMIN_NAME="Admin Name"         (Default: "Local Admin")
 *   ADMIN_IDENTITY="professional"   (Default: "professional", valid: student, professional, freelancer, creator, business)
 *
 * Security & Guardrails:
 *   1. Local development only: Always refuses execution when NODE_ENV === "production".
 *   2. Credential safety: Reads email and password strictly from environment variables.
 *      Never logs passwords or hashes.
 *   3. Password hashing: Uses the platform's bcryptjs utility with standard salt rounds (10).
 *   4. Existing User model: Uses backend/models/User.ts to enforce schema validation.
 *   5. Idempotent non-destructive behavior: If an account exists (student or admin),
 *      reports its current role and stops without overwriting or promoting.
 *   6. Isolation: Exclusively an administrative CLI script. Not exposed to public APIs.
 */

const path = require("node:path");
const fs = require("node:fs");

const projectRoot = path.resolve(__dirname, "..");

// Register TypeScript loader for loading backend TypeScript models/modules
function registerTypeScriptLoader() {
  if (require.extensions[".ts"]) return;
  let ts;
  try {
    ts = require(path.join(projectRoot, "node_modules", "typescript"));
  } catch {
    try {
      ts = require("typescript");
    } catch {
      ts = require(path.join(projectRoot, "..", "portfolio", "node_modules", "typescript"));
    }
  }
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

registerTypeScriptLoader();

// Load environment configuration (.env.local / .env)
function loadEnv() {
  try {
    const { loadEnvConfig } = require(path.join(projectRoot, "node_modules", "@next", "env"));
    loadEnvConfig(projectRoot, true, { info() {}, error() {} });
  } catch (err) {
    // If @next/env is not resolvable, fallback to existing process.env
  }
}

const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
const VALID_IDENTITIES = ["student", "professional", "freelancer", "creator", "business"];

async function seedAdmin(options = {}) {
  const env = options.env || process.env;
  if (env.NODE_ENV === "production") {
    const err = new Error("Refusing to seed admin user in production environment (NODE_ENV=production).");
    err.code = "PRODUCTION_BLOCKED";
    throw err;
  }

  const emailRaw = options.email || env.ADMIN_EMAIL;
  const passwordRaw = options.password || env.ADMIN_PASSWORD;
  const nameRaw = options.name || env.ADMIN_NAME || "Local Admin";
  const identityRaw = options.identity || env.ADMIN_IDENTITY || "professional";

  if (!emailRaw || typeof emailRaw !== "string" || !emailRaw.trim()) {
    const err = new Error(
      "Missing ADMIN_EMAIL environment variable. Example: ADMIN_EMAIL='admin@example.com' ADMIN_PASSWORD='...' node backend/scripts/seed_admin.js"
    );
    err.code = "MISSING_ADMIN_EMAIL";
    throw err;
  }

  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    const err = new Error(`Invalid ADMIN_EMAIL format: "${email}". Must be a valid email address matching user schema.`);
    err.code = "INVALID_EMAIL_FORMAT";
    throw err;
  }

  if (!passwordRaw || typeof passwordRaw !== "string" || !passwordRaw.trim()) {
    const err = new Error("Missing ADMIN_PASSWORD environment variable. Please provide a non-empty password.");
    err.code = "MISSING_ADMIN_PASSWORD";
    throw err;
  }

  const password = passwordRaw;
  if (password.length < 8) {
    const err = new Error("ADMIN_PASSWORD must be at least 8 characters long for secure local administration.");
    err.code = "PASSWORD_TOO_SHORT";
    throw err;
  }

  const name = nameRaw.trim();
  const identity = identityRaw.trim().toLowerCase();
  if (!VALID_IDENTITIES.includes(identity)) {
    const err = new Error(`Invalid ADMIN_IDENTITY: "${identity}". Must be one of: ${VALID_IDENTITIES.join(", ")}`);
    err.code = "INVALID_IDENTITY";
    throw err;
  }

  // Load bcryptjs
  let bcrypt;
  if (options.bcrypt) {
    bcrypt = options.bcrypt;
  } else {
    try {
      bcrypt = require(path.join(projectRoot, "node_modules", "bcryptjs"));
    } catch {
      bcrypt = require("bcryptjs");
    }
  }

  // Load User model & connect to DB
  let UserModel;
  let mongooseInstance = options.mongoose;
  if (options.UserModel) {
    UserModel = options.UserModel;
  } else {
    loadEnv();
    const uri = env.MONGODB_URI || process.env.MONGODB_URI;
    if (!uri) {
      const err = new Error("MONGODB_URI is not set. Please define it in backend/.env.local or environment.");
      err.code = "MISSING_MONGODB_URI";
      throw err;
    }

    try {
      mongooseInstance = require(path.join(projectRoot, "node_modules", "mongoose"));
    } catch {
      mongooseInstance = require("mongoose");
    }

    if (mongooseInstance.connection.readyState === 0) {
      await mongooseInstance.connect(uri, { bufferCommands: false });
    }

    const UserModule = require(path.join(projectRoot, "models", "User.ts"));
    UserModel = UserModule.default || UserModule;
  }

  // Check if account already exists
  const existingUser = await UserModel.findOne({ email }).select("+role +identity");
  if (existingUser) {
    const currentRole = existingUser.role || "student";
    const currentIdentity = existingUser.identity || "unassigned";
    return {
      status: "ALREADY_EXISTS",
      email,
      role: currentRole,
      identity: currentIdentity,
      userId: existingUser._id?.toString?.() || String(existingUser._id || ""),
      message: `Account already exists for email "${email}" with role "${currentRole}". Refusing to overwrite or promote existing account.`,
    };
  }

  // Hash password using project's existing bcrypt hashing utility (salt rounds 10)
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create admin user with role: "admin"
  const newUser = await UserModel.create({
    name,
    email,
    password: hashedPassword,
    role: "admin",
    identity,
    onboarding: {
      surveyCompleted: true,
      survey: null,
    },
  });

  return {
    status: "CREATED",
    email: newUser.email,
    role: newUser.role,
    identity: newUser.identity,
    userId: newUser._id?.toString?.() || String(newUser._id || ""),
    message: `Admin user successfully created for email "${email}" with role "admin".`,
  };
}

async function main() {
  console.log("=================================================================");
  console.log("OneVue — Local Development Admin Provisioning Utility");
  console.log("=================================================================");

  let mongooseInstance = null;
  try {
    try {
      mongooseInstance = require(path.join(projectRoot, "node_modules", "mongoose"));
    } catch {
      mongooseInstance = require("mongoose");
    }

    const result = await seedAdmin();

    if (result.status === "ALREADY_EXISTS") {
      console.log(`[Admin Seed] Account already exists for: ${result.email}`);
      console.log(`[Admin Seed] Current role:     ${result.role}`);
      console.log(`[Admin Seed] Current identity: ${result.identity}`);
      console.log(`[Admin Seed] Status: Account not modified. Existing accounts are never silently promoted or overwritten.`);
    } else if (result.status === "CREATED") {
      console.log(`[Admin Seed] Success! Administrator account provisioned:`);
      console.log(`  User ID:   ${result.userId}`);
      console.log(`  Email:     ${result.email}`);
      console.log(`  Role:      ${result.role}`);
      console.log(`  Identity:  ${result.identity}`);
      console.log(`[Admin Seed] You can now sign in locally and access /app/admin/templates.`);
    }
    console.log("=================================================================");
  } catch (err) {
    console.error(`\n[Admin Seed Error] ${err.message}\n`);
    console.log("Usage:");
    console.log("  ADMIN_EMAIL=\"admin@example.com\" ADMIN_PASSWORD=\"your-secure-password\" node backend/scripts/seed_admin.js\n");
    process.exit(1);
  } finally {
    if (mongooseInstance && mongooseInstance.connection && mongooseInstance.connection.readyState !== 0) {
      try {
        await mongooseInstance.disconnect();
      } catch {
        // Ignore disconnect errors on shutdown
      }
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  seedAdmin,
  EMAIL_REGEX,
  VALID_IDENTITIES,
};
