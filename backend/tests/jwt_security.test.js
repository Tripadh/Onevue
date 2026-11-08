/**
 * P0.3 JWT Secret Security Remediation Test Suite
 *
 * Safe unit tests verifying:
 * 1. Missing secret fails securely.
 * 2. Empty or too-short secret (< 32 bytes) fails securely.
 * 3. Valid configured secret (>= 32 bytes) succeeds.
 * 4. JWT issuance and verification round-trip with claims preservation.
 * 5. Rejection of tokens signed with an incorrect secret.
 * 6. Rejection of tampered / malformed tokens.
 * 7. Rejection of expired tokens.
 * 8. Regression scan ensuring no "fallback_secret" remains in the active backend codebase.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MIN_JWT_SECRET_LENGTH,
  getJwtSecret,
  signJwtToken,
  verifyJwtToken,
} = require("../lib/jwt");

describe("JWT Secret Security & Remediation", () => {
  const originalEnvSecret = process.env.JWT_SECRET;
  const validSecret32 = "a_very_secure_secret_key_at_least_32_chars!";
  const validSecret64 = "another_extremely_secure_key_that_exceeds_64_bytes_for_hashing_purposes!";

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.JWT_SECRET = originalEnvSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  describe("Secret Retrieval & Validation", () => {
    it("fails securely when JWT_SECRET is completely missing from environment", () => {
      delete process.env.JWT_SECRET;
      assert.throws(
        () => getJwtSecret(),
        /JWT_SECRET environment variable is missing or empty/
      );
    });

    it("fails securely when JWT_SECRET is an empty string", () => {
      process.env.JWT_SECRET = "";
      assert.throws(
        () => getJwtSecret(),
        /JWT_SECRET environment variable is missing or empty/
      );
    });

    it("fails securely when JWT_SECRET contains only whitespace", () => {
      process.env.JWT_SECRET = "     ";
      assert.throws(
        () => getJwtSecret(),
        /JWT_SECRET environment variable is missing or empty/
      );
    });

    it("fails securely when JWT_SECRET is shorter than 32 bytes", () => {
      // 15 bytes (the former 'fallback_secret')
      process.env.JWT_SECRET = "fallback_secret";
      assert.throws(
        () => getJwtSecret(),
        /JWT_SECRET is too short \(15 bytes\)\. A secure secret must be at least 32 bytes\./
      );

      // 31 bytes
      process.env.JWT_SECRET = "1234567890123456789012345678901";
      assert.throws(
        () => getJwtSecret(),
        /JWT_SECRET is too short \(31 bytes\)\. A secure secret must be at least 32 bytes\./
      );
    });

    it("does not log, leak, or print secret contents in error messages", () => {
      const sensitiveSecretSnippet = "SENSITIVE_LEAK_TEST_SECRET";
      process.env.JWT_SECRET = sensitiveSecretSnippet;
      try {
        getJwtSecret();
        assert.fail("Expected getJwtSecret to throw");
      } catch (err) {
        assert.ok(!err.message.includes(sensitiveSecretSnippet), "Error message must never contain secret material");
      }
    });

    it("succeeds when configured with a valid secret of 32 bytes", () => {
      process.env.JWT_SECRET = validSecret32;
      const secret = getJwtSecret();
      assert.equal(secret, validSecret32);
      assert.equal(MIN_JWT_SECRET_LENGTH, 32);
    });

    it("succeeds when configured with a valid secret exceeding 32 bytes", () => {
      process.env.JWT_SECRET = validSecret64;
      const secret = getJwtSecret();
      assert.equal(secret, validSecret64);
    });
  });

  describe("Token Issuance & Verification using Centralized Configuration", () => {
    it("fails token issuance when secret is missing or invalid", () => {
      delete process.env.JWT_SECRET;
      assert.throws(
        () => signJwtToken({ id: "user_1" }),
        /JWT_SECRET environment variable is missing or empty/
      );

      process.env.JWT_SECRET = "too_short";
      assert.throws(
        () => signJwtToken({ id: "user_1" }),
        /JWT_SECRET is too short/
      );
    });

    it("fails token verification when centralized secret is missing or invalid", () => {
      process.env.JWT_SECRET = validSecret32;
      const token = signJwtToken({ id: "user_1" });

      delete process.env.JWT_SECRET;
      assert.throws(
        () => verifyJwtToken(token),
        /JWT_SECRET environment variable is missing or empty/
      );

      process.env.JWT_SECRET = "short";
      assert.throws(
        () => verifyJwtToken(token),
        /JWT_SECRET is too short/
      );
    });

    it("issues and verifies a valid token using the same configured secret", () => {
      process.env.JWT_SECRET = validSecret32;
      const payload = {
        id: "507f1f77bcf86cd799439011",
        email: "student@onevue.id",
        identity: "student",
        surveyCompleted: true,
      };

      const token = signJwtToken(payload, { expiresIn: "7d" });
      assert.equal(typeof token, "string");
      assert.equal(token.split(".").length, 3, "JWT must consist of three dot-separated base64url segments");

      const decoded = verifyJwtToken(token);
      assert.equal(decoded.id, payload.id);
      assert.equal(decoded.email, payload.email);
      assert.equal(decoded.identity, payload.identity);
      assert.equal(decoded.surveyCompleted, true);
      assert.ok(decoded.exp > Math.floor(Date.now() / 1000), "Token must have future expiration");
    });

    it("rejects tokens signed with an incorrect secret", () => {
      process.env.JWT_SECRET = validSecret32;
      const token = signJwtToken({ id: "user_1", email: "user@onevue.id" });

      // Change configured secret to another valid secret
      process.env.JWT_SECRET = validSecret64;
      assert.throws(
        () => verifyJwtToken(token),
        /(invalid signature|invalid algorithm)/i
      );
    });

    it("rejects tampered token payloads", () => {
      process.env.JWT_SECRET = validSecret32;
      const token = signJwtToken({ id: "user_1", email: "user@onevue.id", identity: "student" });

      const parts = token.split(".");
      // Tamper with payload by modifying base64url content to elevate privilege
      const tamperedPayload = Buffer.from(
        JSON.stringify({ id: "user_1", email: "user@onevue.id", identity: "admin" })
      ).toString("base64url");
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      assert.throws(
        () => verifyJwtToken(tamperedToken),
        /invalid signature/i
      );
    });

    it("rejects malformed token strings", () => {
      process.env.JWT_SECRET = validSecret32;
      assert.throws(() => verifyJwtToken("not-a-token"), /jwt malformed/i);
      assert.throws(() => verifyJwtToken("part1.part2"), /jwt malformed/i);
      assert.throws(() => verifyJwtToken(""), /jwt (must be provided|malformed)/i);
    });

    it("rejects expired tokens", () => {
      process.env.JWT_SECRET = validSecret32;
      // Expire 10 seconds in past
      const token = signJwtToken({ id: "user_1" }, { expiresIn: -10 });
      assert.throws(
        () => verifyJwtToken(token),
        /jwt expired/i
      );
    });
  });

  describe("Codebase Security Regression Scan", () => {
    it("ensures no 'fallback_secret' string exists anywhere in backend active source or tests", () => {
      const backendDir = path.resolve(__dirname, "..");
      const filesWithFallback = [];

      function scanDir(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // Ignore node_modules, .git, and build output if present
            if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next" || entry.name === "archive") {
              continue;
            }
            scanDir(fullPath);
          } else if (entry.isFile()) {
            if (fullPath === __filename) {
              continue;
            }
            if (
              fullPath.endsWith(".ts") ||
              fullPath.endsWith(".js") ||
              fullPath.endsWith(".json") ||
              fullPath.endsWith(".example")
            ) {
              const content = fs.readFileSync(fullPath, "utf8");
              if (content.includes("fallback_secret")) {
                filesWithFallback.push(path.relative(backendDir, fullPath));
              }
            }
          }
        }
      }

      scanDir(backendDir);
      assert.deepEqual(
        filesWithFallback,
        [],
        `Found forbidden fallback_secret in active backend files: ${filesWithFallback.join(", ")}`
      );
    });
  });
});
