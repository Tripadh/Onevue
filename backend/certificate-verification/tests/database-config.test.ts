import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTestMongoUri,
  requireMongoUri,
} from "../src/db/database-config.js";

describe("database configuration", () => {
  it("requires a MongoDB URI and does not echo secrets", () => {
    assert.throws(() => requireMongoUri({}), /MONGODB_URI is required/);
    assert.throws(
      () => requireMongoUri({ MONGODB_URI: "   " }),
      /will not start with in-memory storage/,
    );

    const secret = "mongodb://user:s3cret-password@db.internal:27017/onevue";
    assert.equal(requireMongoUri({ MONGODB_URI: `  ${secret}  ` }), secret);

    try {
      requireMongoUri({ MONGODB_URI: "" });
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
      assertTestMongoUri(
        "mongodb://USER:PASSWORD@localhost:27017/certificate_verification_test",
      ),
    );
    assert.throws(
      () =>
        assertTestMongoUri(
          "mongodb://USER:PASSWORD@localhost:27017/certificate_verification",
        ),
      /contains "test"/,
    );
    assert.throws(() => assertTestMongoUri("not a url"), /contains "test"/);
  });
});
