import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadServiceTokenFromEnvFile } from "../src/config/load-env-file.js";

describe("loadServiceTokenFromEnvFile", () => {
  it("replaces a stale process token with the env file token", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cert-env-"));
    const envPath = path.join(dir, ".env");
    fs.writeFileSync(
      envPath,
      'MONGODB_URI=mongodb://example/unchanged\nCERTIFICATE_SERVICE_TOKEN="file-token-value"\n',
    );
    const env: NodeJS.ProcessEnv = {
      CERTIFICATE_SERVICE_TOKEN: "stale-shell-token",
      MONGODB_URI: "mongodb://example/original",
    };

    const result = loadServiceTokenFromEnvFile(envPath, env);

    assert.equal(result.loaded, true);
    assert.equal(result.tokenPresent, true);
    assert.equal(result.tokenLength, "file-token-value".length);
    assert.equal(env.CERTIFICATE_SERVICE_TOKEN, "file-token-value");
    assert.equal(env.MONGODB_URI, "mongodb://example/original");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the process token when the env file has no token", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cert-env-"));
    const envPath = path.join(dir, ".env");
    fs.writeFileSync(envPath, "PORT=3001\n");
    const env: NodeJS.ProcessEnv = { CERTIFICATE_SERVICE_TOKEN: "kept-token" };

    const result = loadServiceTokenFromEnvFile(envPath, env);

    assert.equal(result.loaded, true);
    assert.equal(env.CERTIFICATE_SERVICE_TOKEN, "kept-token");
    assert.equal(result.tokenLength, "kept-token".length);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
