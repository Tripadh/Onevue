import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTestDatabaseUrl,
  requireDatabaseUrl,
} from "../src/db/database-config.js";

describe("database configuration", () => {
  it("requires a database URL and does not echo secrets", () => {
    assert.throws(() => requireDatabaseUrl({}), /DATABASE_URL is required/);
    assert.throws(
      () => requireDatabaseUrl({ DATABASE_URL: "   " }),
      /will not start with in-memory storage/,
    );

    const secret = "postgresql://user:s3cret-password@db.internal:5432/app";
    assert.equal(requireDatabaseUrl({ DATABASE_URL: `  ${secret}  ` }), secret);

    try {
      requireDatabaseUrl({ DATABASE_URL: "" });
    } catch (error) {
      assert.equal(error instanceof Error, true);
      if (error instanceof Error) {
        assert.equal(error.message.includes("s3cret-password"), false);
        assert.equal(error.message.includes("db.internal"), false);
      }
    }
  });

  it("accepts only a test database name for integration tests", () => {
    assert.doesNotThrow(() =>
      assertTestDatabaseUrl(
        "postgresql://USER:PASSWORD@localhost:5432/certificate_verification_test",
      ),
    );
    assert.throws(
      () =>
        assertTestDatabaseUrl(
          "postgresql://USER:PASSWORD@localhost:5432/certificate_verification",
        ),
      /contains "test"/,
    );
    assert.throws(() => assertTestDatabaseUrl("not a url"), /contains "test"/);
  });
});
