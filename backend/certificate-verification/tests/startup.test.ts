import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function runService(
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/index.ts"],
    {
      cwd: serviceRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("certificate-verification startup timed out"));
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    void once(child, "exit").then(([code]) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.MONGODB_URI;
  delete env.DATABASE_URL;
  delete env.CERTIFICATE_SERVICE_TOKEN;
  return env;
}

describe("certificate service startup", () => {
  it("exits when MongoDB is not configured and does not use in-memory storage", async () => {
    const result = await runService(baseEnv());
    assert.equal(result.code, 1);
    assert.match(result.stderr, /MONGODB_URI is required/);
    assert.match(result.stderr, /will not start with in-memory storage/);
  });

  it("exits when MongoDB is unreachable and does not echo the URI", async () => {
    const result = await runService({
      ...baseEnv(),
      MONGODB_URI:
        "mongodb://user:s3cret@127.0.0.1:1/certificate_verification_test",
    });
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /Could not connect to the certificate database\./,
    );
    assert.equal(result.stderr.includes("s3cret"), false);
    assert.equal(result.stderr.includes("127.0.0.1"), false);
  });
});
