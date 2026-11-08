const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

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

const { CloudflareR2StorageAdapter } = require("../lib/template-storage.ts");
const { verifyAndPackageArtifact } = require("../lib/template-build.ts");

const liveTestEnabled = process.env.RUN_LIVE_R2_TESTS === "true";
const liveStorageEnabled = process.env.ENABLE_LIVE_R2_STORAGE === "true";
const canRun = liveTestEnabled && liveStorageEnabled;

function createTestArtifact(templateId, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-r2-live-artifact-"));
  try {
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>OneVue R2 compatibility test</title>");
    fs.writeFileSync(path.join(dir, "assets", "app.js"), "console.log('onevue-r2-compatibility-test');");

    const packaged = verifyAndPackageArtifact(dir, {
      templateId,
      templateVersion: version,
      sourceCommitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      supportedDtoVersions: ["1.0.0"],
    });
    assert.equal(packaged.valid, true);

    return {
      dir,
      manifest: packaged.manifest,
      cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function objectKey(templateId, version, relativePath) {
  return `templates/${templateId}/${version}/${relativePath}`;
}

function readLiveTestConfig() {
  return {
    accountId: process.env.CLOUDFLARE_R2_LIVE_TEST_ACCOUNT_ID,
    accessKeyId: process.env.CLOUDFLARE_R2_LIVE_TEST_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_LIVE_TEST_SECRET_ACCESS_KEY,
    bucketName: process.env.CLOUDFLARE_R2_LIVE_TEST_BUCKET_NAME,
  };
}

function validateLiveTestConfig(config) {
  if (!/^[a-f0-9]{32}$/i.test(config.accountId || "")) return "A dedicated 32-character hexadecimal test account ID is required.";
  if (!/^[A-Za-z0-9]{16,128}$/.test(config.accessKeyId || "")) return "A dedicated test access key ID is required.";
  if (!/^\S{20,256}$/.test(config.secretAccessKey || "")) return "A dedicated test secret access key is required.";
  if (!/^onevue-r2-compat-test-[a-z0-9-]{1,45}$/.test(config.bucketName || "")) return "A dedicated onevue-r2-compat-test-* bucket name is required.";
  return undefined;
}

async function deleteOwnedObject(adapter, key, ownedPrefix) {
  if (!key.startsWith(ownedPrefix) || key.includes("..")) {
    throw new Error("Cleanup refused an object outside the current test prefix.");
  }
  const headers = adapter.signRequest({ method: "DELETE", pathKey: key });
  const response = await adapter.request(adapter.objectUrl(key), {
    method: "DELETE",
    headers,
  });
  if (![204, 404].includes(response.status)) {
    throw new Error(`Cleanup failed for owned test object (status ${response.status}).`);
  }
}

async function assertOwnedObjectsAbsent(adapter, ownedKeys, ownedPrefix) {
  for (const key of ownedKeys) {
    if (!key.startsWith(ownedPrefix)) {
      throw new Error("Preflight refused an object outside the current test prefix.");
    }
    const headers = adapter.signRequest({ method: "HEAD", pathKey: key });
    const response = await adapter.request(adapter.objectUrl(key), { method: "HEAD", headers });
    if (response.status === 200) {
      throw new Error("Live R2 preflight found a pre-existing test object; refusing to delete it.");
    }
    if (response.status !== 404) {
      throw new Error(`Live R2 preflight failed for an owned test object (status ${response.status}).`);
    }
  }
}

async function cleanupOwnedObjects(adapter, ownedKeys, ownedPrefix) {
  let firstFailure;
  for (const key of ownedKeys) {
    try {
      await deleteOwnedObject(adapter, key, ownedPrefix);
    } catch (error) {
      firstFailure ||= error;
    }
  }
  if (firstFailure) {
    throw new Error(`Owned R2 test cleanup failed: ${firstFailure instanceof Error ? firstFailure.message : String(firstFailure)}`);
  }
}

describe("Phase 5.9 — Controlled Cloudflare R2 compatibility", { skip: !canRun }, () => {
  it("verifies SigV4, conditional creation, interruption recovery, and owned cleanup", async () => {
    const config = readLiveTestConfig();
    assert.equal(validateLiveTestConfig(config), undefined);

    const templateId = `r2-compat-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const version = "0.0.1";
    const artifact = createTestArtifact(templateId, version);
    const ownedPrefix = `templates/${templateId}/${version}/`;
    const ownedKeys = new Set([
      ...artifact.manifest.files.map((file) => objectKey(templateId, version, file.relativePath)),
      objectKey(templateId, version, "onevue-manifest.json"),
    ]);
    const liveFetch = globalThis.fetch;
    let successfulAssetUploads = 0;

    const interruptedFetch = async (url, init) => {
      const isAssetPut = init?.method === "PUT" && !String(url).endsWith("/onevue-manifest.json");
      const response = await liveFetch(url, init);
      if (isAssetPut && successfulAssetUploads++ === 0) {
        throw new Error("Intentional Phase 5.9 interruption after server accepted an asset upload.");
      }
      return response;
    };

    const adapter = new CloudflareR2StorageAdapter({
      enabled: true,
      ...config,
      fetchImpl: interruptedFetch,
    });
    let activeAdapter = adapter;
    let primaryFailure;

    try {
      await assertOwnedObjectsAbsent(adapter, ownedKeys, ownedPrefix);
      const interrupted = await adapter.storeArtifact(templateId, version, artifact.dir, artifact.manifest);
      assert.equal(interrupted.success, false);
      assert.equal(interrupted.outcome, "STORAGE_ERROR");

      const conflictingRetry = await adapter.storeArtifact(templateId, version, artifact.dir, artifact.manifest);
      assert.equal(conflictingRetry.success, false);
      assert.equal(conflictingRetry.outcome, "COLLISION");

      await cleanupOwnedObjects(activeAdapter, ownedKeys, ownedPrefix);

      const completed = new CloudflareR2StorageAdapter({
        enabled: true,
        ...config,
      });
      activeAdapter = completed;
      const stored = await completed.storeArtifact(templateId, version, artifact.dir, artifact.manifest);
      assert.equal(stored.success, true);

      const validated = await completed.validateStoredArtifact(templateId, version);
      assert.equal(validated.success, true);

      const duplicate = await completed.storeArtifact(templateId, version, artifact.dir, artifact.manifest);
      assert.equal(duplicate.success, false);
      assert.equal(duplicate.outcome, "COLLISION");

      const file = artifact.manifest.files[0];
      const key = objectKey(templateId, version, file.relativePath);
      const body = fs.readFileSync(path.join(artifact.dir, file.relativePath));
      const conditionalHeaders = completed.signRequest({
        method: "PUT",
        pathKey: key,
        bodyBuffer: body,
        contentType: "application/octet-stream",
        extraHeaders: { "if-none-match": "*" },
      });
      const conditionalDuplicate = await completed.request(completed.objectUrl(key), {
        method: "PUT",
        headers: conditionalHeaders,
        body,
      });
      assert.equal(conditionalHeaders.authorization.includes("/auto/s3/aws4_request"), true);
      assert.equal(conditionalDuplicate.status, 412);
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      let cleanupError;
      try {
        await cleanupOwnedObjects(activeAdapter, ownedKeys, ownedPrefix);
      } catch (error) {
        cleanupError = error;
      }
      try {
        artifact.cleanup();
      } finally {
        if (cleanupError) {
          if (primaryFailure && primaryFailure instanceof Error) {
            primaryFailure.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          } else {
            throw cleanupError;
          }
        }
      }
    }
  });
});
