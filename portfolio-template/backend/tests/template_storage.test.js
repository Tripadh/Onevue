/**
 * =========================================================================
 * OneVue Phase 5.5 / 5.7B — R2 Storage Adapter Test Suite
 * =========================================================================
 */

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
  ts = require("/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript");
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

const {
  LocalFilesystemStorageAdapter,
  MockR2StorageAdapter,
  CloudflareR2StorageAdapter,
  computeManifestChecksum,
} = require("../lib/template-storage.ts");

const { verifyAndPackageArtifact } = require("../lib/template-build.ts");

function createTempStagedArtifact(templateVersion = "1.0.0") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-artifact-"));
  fs.writeFileSync(path.join(tmpDir, "index.html"), "<!DOCTYPE html><html><body>Home</body></html>");
  fs.mkdirSync(path.join(tmpDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "assets", "app.js"), "console.log('app');");

  const pkgRes = verifyAndPackageArtifact(tmpDir, {
    templateId: "magicui-portfolio",
    templateVersion,
    sourceCommitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
    supportedDtoVersions: ["1.0.0"],
  });

  return {
    dir: tmpDir,
    manifest: pkgRes.manifest,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

describe("Phase 5.5 & 5.7B — R2 Storage Adapter Foundation", () => {
  it("stores, retrieves, and validates a packaged artifact successfully via LocalFilesystemStorageAdapter", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-storage-root-"));
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);
    const staged = createTempStagedArtifact();

    try {
      const existsBefore = await adapter.checkVersionExists("magicui-portfolio", "1.0.0");
      assert.equal(existsBefore, false);

      const storeResult = await adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest);
      assert.equal(storeResult.success, true);
      assert.equal(storeResult.outcome, "SUCCESS");

      const existsAfter = await adapter.checkVersionExists("magicui-portfolio", "1.0.0");
      assert.equal(existsAfter, true);

      const retrieveResult = await adapter.retrieveArtifact("magicui-portfolio", "1.0.0");
      assert.equal(retrieveResult.success, true);
      assert.equal(retrieveResult.manifest.templateId, "magicui-portfolio");

      const validateResult = await adapter.validateStoredArtifact("magicui-portfolio", "1.0.0");
      assert.equal(validateResult.success, true);
      assert.equal(validateResult.outcome, "SUCCESS");
    } finally {
      staged.cleanup();
      try {
        fs.rmSync(storageRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("rejects a caller manifest that differs from the packaged source manifest", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-storage-root-"));
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);
    const staged = createTempStagedArtifact();
    const mismatchedManifest = { ...staged.manifest, manifestSha256: "0".repeat(64) };

    try {
      const result = await adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, mismatchedManifest);
      assert.equal(result.success, false);
      assert.equal(result.outcome, "INTEGRITY_FAILURE");
      assert.ok(result.error.includes("does not match the source release manifest"));
    } finally {
      staged.cleanup();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it("rejects a stored manifest missing required schema metadata", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-storage-root-"));
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);
    const staged = createTempStagedArtifact();
    const manifestPath = path.join(staged.dir, "onevue-manifest.json");
    const incompleteManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    delete incompleteManifest.supportedDtoVersions;
    incompleteManifest.manifestSha256 = computeManifestChecksum(incompleteManifest);
    fs.writeFileSync(manifestPath, JSON.stringify(incompleteManifest, null, 2));

    try {
      const result = await adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, incompleteManifest);
      assert.equal(result.success, false);
      assert.equal(result.outcome, "INTEGRITY_FAILURE");
      assert.ok(result.error.includes("Manifest schema metadata is invalid"));
    } finally {
      staged.cleanup();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it("enforces immutable version collision: refuses to overwrite an existing stored version", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-storage-root-"));
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);
    const staged = createTempStagedArtifact();

    try {
      const firstStore = await adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest);
      assert.equal(firstStore.success, true);

      const secondStore = await adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest);
      assert.equal(secondStore.success, false);
      assert.equal(secondStore.outcome, "COLLISION");
      assert.ok(secondStore.error.includes("Overwrite is strictly prohibited"));
    } finally {
      staged.cleanup();
      try {
        fs.rmSync(storageRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("returns NOT_FOUND when retrieving an un-stored version", async () => {
    const adapter = new LocalFilesystemStorageAdapter();
    const res = await adapter.retrieveArtifact("magicui-portfolio", "9.9.9");
    assert.equal(res.success, false);
    assert.equal(res.outcome, "NOT_FOUND");
  });

  it("detects tampered file contents and fails cryptographic validation (INTEGRITY_FAILURE)", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-storage-root-"));
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);
    const staged = createTempStagedArtifact();

    try {
      const storeResult = await adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest);
      assert.equal(storeResult.success, true);

      const targetFilePath = path.join(storeResult.artifactDir, "assets", "app.js");
      fs.writeFileSync(targetFilePath, "malicious code injected", "utf8");

      const validateResult = await adapter.validateStoredArtifact("magicui-portfolio", "1.0.0");
      assert.equal(validateResult.success, false);
      assert.equal(validateResult.outcome, "INTEGRITY_FAILURE");
      assert.ok(validateResult.error.includes("SHA-256 hash mismatch"));
    } finally {
      staged.cleanup();
      try {
        fs.rmSync(storageRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("rejects symlinked stored files during integrity validation", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-storage-root-"));
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);
    const staged = createTempStagedArtifact();
    const outside = path.join(os.tmpdir(), "onevue-outside-artifact.txt");
    fs.writeFileSync(outside, "outside");

    try {
      const stored = await adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest);
      const target = path.join(stored.artifactDir, "assets", "app.js");
      fs.rmSync(target);
      fs.symlinkSync(outside, target);
      const result = await adapter.validateStoredArtifact("magicui-portfolio", "1.0.0");
      assert.equal(result.success, false);
      assert.equal(result.outcome, "INTEGRITY_FAILURE");
    } finally {
      staged.cleanup();
      fs.rmSync(outside, { force: true });
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it("rejects artifacts containing prohibited files (.env)", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-storage-root-"));
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);
    const staged = createTempStagedArtifact();

    fs.writeFileSync(path.join(staged.dir, ".env"), "SECRET=true");

    try {
      const storeResult = await adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest);
      assert.equal(storeResult.success, false);
      assert.ok(storeResult.error.includes("Prohibited file in artifact"));
    } finally {
      staged.cleanup();
      try {
        fs.rmSync(storageRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("exercises MockR2StorageAdapter successfully without network access", async () => {
    const mockR2 = new MockR2StorageAdapter();
    const staged = createTempStagedArtifact("2.0.0");

    try {
      const store = await mockR2.storeArtifact("magicui-portfolio", "2.0.0", staged.dir, staged.manifest);
      assert.equal(store.success, true);

      const validate = await mockR2.validateStoredArtifact("magicui-portfolio", "2.0.0");
      assert.equal(validate.success, true);
    } finally {
      staged.cleanup();
    }
  });

  it("CloudflareR2StorageAdapter fails closed by default", async () => {
    const r2Real = new CloudflareR2StorageAdapter();
    const res = await r2Real.storeArtifact("magicui-portfolio", "1.0.0", "/tmp", {});
    assert.equal(res.success, false);
    assert.ok(res.error.includes("disabled by server configuration"));
  });

  it("CloudflareR2StorageAdapter succeeds with mock fetch transport when enabled and configured", async () => {
    const staged = createTempStagedArtifact("3.0.0");
    let headCalled = false;
    let putCalled = 0;

    const mockFetch = async (url, init) => {
      const urlStr = String(url);
      if (init?.method === "HEAD") {
        headCalled = true;
        return new Response(null, { status: 404 });
      }
      if (init?.method === "PUT") {
        putCalled++;
        return new Response(null, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };

    const r2Adapter = new CloudflareR2StorageAdapter({
      enabled: true,
      accountId: "testaccount1234567890",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      bucketName: "onevue-templates",
      fetchImpl: mockFetch,
    });

    try {
      const storeRes = await r2Adapter.storeArtifact("magicui-portfolio", "3.0.0", staged.dir, staged.manifest);
      assert.equal(storeRes.success, true);
      assert.equal(headCalled, true);
      assert.ok(putCalled > 0);
      assert.equal(storeRes.storageLocation, "r2://onevue-templates/templates/magicui-portfolio/3.0.0/");
    } finally {
      staged.cleanup();
    }
  });

  it("CloudflareR2StorageAdapter rejects immutable collision when version already exists", async () => {
    const staged = createTempStagedArtifact();

    const mockFetch = async (url, init) => {
      if (init?.method === "HEAD") {
        return new Response(null, { status: 200 });
      }
      return new Response("OK", { status: 200 });
    };

    const r2Adapter = new CloudflareR2StorageAdapter({
      enabled: true,
      accountId: "testaccount1234567890",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      bucketName: "onevue-templates",
      fetchImpl: mockFetch,
    });

    try {
      const storeRes = await r2Adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest);
      assert.equal(storeRes.success, false);
      assert.equal(storeRes.outcome, "COLLISION");
      assert.ok(storeRes.error.includes("already exists in R2 bucket"));
    } finally {
      staged.cleanup();
    }
  });

  it("generates deterministic RFC3986 SigV4 headers for encoded object keys", () => {
    const adapter = new CloudflareR2StorageAdapter({
      enabled: true,
      accountId: "testaccount1234567890",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      bucketName: "onevue bucket",
      clock: () => new Date("2015-08-30T12:36:00Z"),
    });

    const headers = adapter.signRequest({
      method: "GET",
      pathKey: "templates/demo/1.0.0/file name!'().txt",
    });
    const canonicalRequest = [
      "GET",
      "/onevue%20bucket/templates/demo/1.0.0/file%20name%21%27%28%29.txt",
      "",
      "host:testaccount1234567890.r2.cloudflarestorage.com\n" +
        "x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n" +
        "x-amz-date:20150830T123600Z\n",
      "host;x-amz-content-sha256;x-amz-date",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ].join("\n");
    const scope = "20150830/auto/s3/aws4_request";
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      "20150830T123600Z",
      scope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
    const signingKey = hmac(hmac(hmac(hmac(`AWS${"4"}wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, "20150830"), "auto"), "s3"), "aws4_request");
    const expectedSignature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    assert.equal(headers["x-amz-date"], "20150830T123600Z");
    assert.ok(headers.authorization.endsWith(`Signature=${expectedSignature}`));
  });

  it("does not overwrite when concurrent writers race after both HEAD requests miss", async () => {
    const staged = createTempStagedArtifact();
    const objects = new Set();
    const mockFetch = async (url, init) => {
      const objectKey = String(url).split(".com/")[1];
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (init?.method === "PUT") {
        if (objects.has(objectKey)) return new Response(null, { status: 412 });
        objects.add(objectKey);
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    };
    const adapter = new CloudflareR2StorageAdapter({
      enabled: true,
      accountId: "testaccount1234567890",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      bucketName: "onevue-templates",
      fetchImpl: mockFetch,
    });

    try {
      const results = await Promise.all([
        adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest),
        adapter.storeArtifact("magicui-portfolio", "1.0.0", staged.dir, staged.manifest),
      ]);
      assert.equal(results.filter((result) => result.success).length, 1);
      assert.equal(results.filter((result) => result.outcome === "COLLISION").length, 1);
    } finally {
      staged.cleanup();
    }
  });

  it("verifies every remote file, not just the retrieved manifest", async () => {
    const staged = createTempStagedArtifact();
    const manifestJson = fs.readFileSync(path.join(staged.dir, "onevue-manifest.json"), "utf8");
    const fileContents = new Map(staged.manifest.files.map((file) => [file.relativePath, fs.readFileSync(path.join(staged.dir, file.relativePath))]));
    const mockFetch = async (url, init) => {
      const pathname = new URL(url).pathname;
      if (init?.method !== "GET") return new Response(null, { status: 404 });
      if (pathname.endsWith("/onevue-manifest.json")) return new Response(manifestJson, { status: 200 });
      const relativePath = pathname.split("/templates/magicui-portfolio/1.0.0/")[1];
      return new Response(fileContents.get(relativePath), { status: 200 });
    };
    const adapter = new CloudflareR2StorageAdapter({
      enabled: true,
      accountId: "testaccount1234567890",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      bucketName: "onevue-templates",
      fetchImpl: mockFetch,
    });

    try {
      const result = await adapter.validateStoredArtifact("magicui-portfolio", "1.0.0");
      assert.equal(result.success, true);
    } finally {
      staged.cleanup();
    }
  });

  it("rejects a remote manifest without a cryptographic checksum", async () => {
    const staged = createTempStagedArtifact();
    const unsignedManifest = { ...staged.manifest };
    delete unsignedManifest.manifestSha256;
    const mockFetch = async (url, init) => {
      if (init?.method !== "GET") return new Response(null, { status: 404 });
      return new Response(JSON.stringify(unsignedManifest), { status: 200 });
    };
    const adapter = new CloudflareR2StorageAdapter({
      enabled: true,
      accountId: "testaccount1234567890",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      bucketName: "onevue-templates",
      fetchImpl: mockFetch,
    });

    try {
      const result = await adapter.validateStoredArtifact("magicui-portfolio", "1.0.0");
      assert.equal(result.success, false);
      assert.equal(result.outcome, "INTEGRITY_FAILURE");
      assert.ok(result.error.includes("cryptographic checksum"));
    } finally {
      staged.cleanup();
    }
  });
});
