/**
 * =========================================================================
 * OneVue Phase 5.14 — Lifecycle Provenance -> Delivery Boundary
 * =========================================================================
 *
 * These are HANDLER-LEVEL tests: they execute the backend's real Next.js route
 * handler (app/api/public/template-artifact/[...path]/route.ts) and the real
 * lifecycle orchestration in-process. They do not start a Next.js server.
 *
 * Provenance chain under test:
 *
 *   approved review -> orchestrateTemplateLifecycle
 *     (adapt -> build+package -> store -> validate)
 *     -> LocalFilesystemStorageAdapter (temporary storage root)
 *     -> template-artifact-delivery boundary
 *     -> the actual public route handler
 *     -> bytes handed to the visitor
 *
 * The build stage uses the repository's MockBuildExecutor: a genuine isolated
 * runtime (docker/nsjail/...) is not available in this environment and the
 * isolation boundary is deliberately NOT bypassed. The executor input is a
 * trusted, pre-authored set of files; every other stage (adaptation, packaging,
 * immutable storage, manifest validation) is the production implementation.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");

// ---------------------------------------------------------------------------
// TypeScript transpile hook (same pattern as the rest of the backend suite).
// ---------------------------------------------------------------------------
const ts = require("typescript");
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

// The route imports `next/server`; the backend app has no installed
// dependencies in this environment, so resolve it from the portfolio app the
// same way the local stub server does.
if (!/portfolio[\\/]node_modules/.test(process.env.NODE_PATH || "")) {
  process.env.NODE_PATH = [
    path.resolve(__dirname, "../../portfolio/node_modules"),
    process.env.NODE_PATH,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();
}

const {
  orchestrateTemplateLifecycle,
  InMemoryLifecyclePersistence,
} = require("../lib/template-lifecycle.ts");
const { MockBuildExecutor } = require("../lib/template-build.ts");
const {
  LocalFilesystemStorageAdapter,
} = require("../lib/template-storage.ts");
const {
  deliverTemplateAsset,
  readDeliveredAsset,
  setDefaultStorageAdapter,
} = require("../lib/template-artifact-delivery.ts");
const route = require("../app/api/public/template-artifact/[...path]/route.ts");

const TEMPLATE_ID = "lifecycle-delivery-template";
const VERSION_A = "1.0.0";
const VERSION_B = "1.1.0";
const COMMIT_SHA = "bc1589d81640a2bb0377484df2438515cecf0c29";

/**
 * Trusted prebuilt output for the build stage. Two versions deliberately share
 * the SAME relative asset path with different bytes, so a version mix-up would
 * be detectable by content.
 */
function mockFilesFor(version) {
  return {
    "index.html": `<!DOCTYPE html><html><head><!-- <script type="application/json" id="__ONEVUE_DTO__">{}</script> --><script type="module" src="/templates/${TEMPLATE_ID}/${version}/assets/index.js"></script><link rel="stylesheet" href="/templates/${TEMPLATE_ID}/${version}/assets/index.css"></head><body><div id="root"></div></body></html>`,
    "assets/index.js": `console.log("lifecycle artifact ${version}");`,
    "assets/index.css": `body { --release: "${version}"; }`,
    "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, version === VERSION_A ? 0x01 : 0x02]),
  };
}

function createSource() {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-514-source-"));
  fs.mkdirSync(path.join(sourceDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, "package.json"),
    JSON.stringify({ name: "lifecycle-delivery-source", version: "1.0.0", scripts: { build: "vite build" } })
  );
  fs.writeFileSync(path.join(sourceDir, "vite.config.js"), "export default {};\n");
  fs.writeFileSync(path.join(sourceDir, "src", "main.js"), "console.log('source');\n");
  return sourceDir;
}

function reviewFor(ingestionId, version) {
  return {
    ingestionId,
    status: "approved",
    auditReport: { outcome: "PASS" },
    reviewDecision: { reason: "approved by phase 5.14 integration test" },
    sourceCommitSha: COMMIT_SHA,
    templateId: TEMPLATE_ID,
    templateVersion: version,
  };
}

function initialRecord(review) {
  return {
    ingestionId: review.ingestionId,
    status: "APPROVED",
    templateId: review.templateId,
    templateVersion: review.templateVersion,
    sourceCommitSha: review.sourceCommitSha,
    updatedAt: new Date(0).toISOString(),
  };
}

/** Runs the REAL lifecycle for one immutable release. */
async function runRealLifecycle(storageRoot, version) {
  const review = reviewFor(`ing_514_${version.replace(/\./g, "_")}`, version);
  const sourceDir = createSource();
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-514-stage-"));

  const result = await orchestrateTemplateLifecycle({
    sourceDir,
    sourceCleanup: async () => fs.rmSync(sourceDir, { recursive: true, force: true }),
    review,
    explicitConfirmation: true,
    persistence: new InMemoryLifecyclePersistence([initialRecord(review)]),
    storageAdapter: new LocalFilesystemStorageAdapter(storageRoot),
    buildExecutor: new MockBuildExecutor({ mockFiles: mockFilesFor(version) }),
    stagedArtifactsRoot: stageRoot,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  return { review, result, stageRoot };
}

function routeGet(segments) {
  const request = new Request(`http://127.0.0.1/api/public/template-artifact/${segments.join("/")}`);
  return route.GET(request, { params: Promise.resolve({ path: segments }) });
}

function copyRelease(storageRoot, targetRoot, version) {
  const source = path.join(storageRoot, "templates", TEMPLATE_ID, version);
  const target = path.join(targetRoot, "templates", TEMPLATE_ID, version);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return target;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

describe("Phase 5.14 — lifecycle provenance through the public delivery boundary", () => {
  let storageRoot;
  let adapter;
  let releaseA;
  let releaseB;
  const scratchRoots = [];

  function scratchStorageRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-514-scratch-"));
    scratchRoots.push(root);
    return root;
  }

  before(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-514-storage-"));
    adapter = new LocalFilesystemStorageAdapter(storageRoot);
    setDefaultStorageAdapter(adapter);

    releaseA = await runRealLifecycle(storageRoot, VERSION_A);
    releaseB = await runRealLifecycle(storageRoot, VERSION_B);
  });

  after(() => {
    setDefaultStorageAdapter(null);
    for (const root of [storageRoot, ...scratchRoots]) {
      if (root && fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("produces and stores both releases through the real lifecycle", () => {
    for (const run of [releaseA, releaseB]) {
      assert.equal(run.result.success, true, run.result.error);
      assert.equal(run.result.status, "CATALOG_ELIGIBLE");
      assert.ok(run.result.manifestSha256, "The lifecycle must record a manifest checksum");
      assert.ok(
        String(run.result.storageLocation).startsWith(`file://${storageRoot}`),
        "The lifecycle must store the release in the adapter under test"
      );
    }
    assert.notEqual(releaseA.result.manifestSha256, releaseB.result.manifestSha256);
  });

  it("serves the exact bytes the lifecycle stored, for the requested version", async () => {
    for (const [version, run] of [
      [VERSION_A, releaseA],
      [VERSION_B, releaseB],
    ]) {
      const storedIndex = fs.readFileSync(
        path.join(storageRoot, "templates", TEMPLATE_ID, version, "index.html")
      );

      const res = await routeGet([TEMPLATE_ID, version, "index.html"]);
      assert.equal(res.status, 200);
      const body = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(body, storedIndex, `Served entrypoint must equal stored bytes for ${version}`);
      assert.equal(res.headers.get("x-onevue-template-id"), TEMPLATE_ID);
      assert.equal(res.headers.get("x-onevue-template-version"), version);
      assert.equal(res.headers.get("x-onevue-artifact-manifest-sha256"), run.result.manifestSha256);
    }
  });

  it("keeps two release versions isolated with no asset collision", async () => {
    const resA = await routeGet([TEMPLATE_ID, VERSION_A, "assets/index.js"]);
    const resB = await routeGet([TEMPLATE_ID, VERSION_B, "assets/index.js"]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    const bodyA = Buffer.from(await resA.arrayBuffer());
    const bodyB = Buffer.from(await resB.arrayBuffer());
    assert.equal(bodyA.toString("utf8"), `console.log("lifecycle artifact ${VERSION_A}");`);
    assert.equal(bodyB.toString("utf8"), `console.log("lifecycle artifact ${VERSION_B}");`);
    assert.notDeepEqual(bodyA, bodyB);

    for (const [version, body] of [
      [VERSION_A, bodyA],
      [VERSION_B, bodyB],
    ]) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(storageRoot, "templates", TEMPLATE_ID, version, "onevue-manifest.json"), "utf8")
      );
      const entry = manifest.files.find((f) => f.relativePath === "assets/index.js");
      assert.equal(sha256(body), entry.sha256, `Served asset must match its manifest digest for ${version}`);
    }
  });

  it("returns the correct content type and immutable cache headers", async () => {
    const expectations = [
      ["index.html", "text/html; charset=utf-8"],
      ["assets/index.js", "application/javascript; charset=utf-8"],
      ["assets/index.css", "text/css; charset=utf-8"],
      ["assets/logo.png", "image/png"],
    ];
    for (const [assetPath, contentType] of expectations) {
      const res = await routeGet([TEMPLATE_ID, VERSION_A, assetPath]);
      assert.equal(res.status, 200, `${assetPath} must be delivered`);
      assert.equal(res.headers.get("content-type"), contentType);
      assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    }

    const html = await routeGet([TEMPLATE_ID, VERSION_A, "index.html"]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(storageRoot, "templates", TEMPLATE_ID, VERSION_A, "onevue-manifest.json"), "utf8")
    );
    const entry = manifest.files.find((f) => f.relativePath === "index.html");
    assert.equal(html.headers.get("etag"), `"${entry.sha256}"`);
    assert.equal(Number(html.headers.get("content-length")), entry.sizeBytes);
  });

  it("rejects path traversal, absolute paths and malformed identities", async () => {
    const cases = [
      [[TEMPLATE_ID, VERSION_A, "..", "onevue-manifest.json"], "UNSAFE_PATH"],
      [[TEMPLATE_ID, VERSION_A, "assets/../../onevue-manifest.json"], "UNSAFE_PATH"],
      [[TEMPLATE_ID, VERSION_A, "/etc/passwd"], "UNSAFE_PATH"],
      [[TEMPLATE_ID, VERSION_A, "C:/windows/system32"], "UNSAFE_PATH"],
      [["../etc", VERSION_A, "index.html"], "INVALID_IDENTITY"],
      [["Community Template", VERSION_A, "index.html"], "INVALID_IDENTITY"],
      [[TEMPLATE_ID, "1.0", "index.html"], "INVALID_IDENTITY"],
      [[TEMPLATE_ID, "1.0.0/../1.1.0", "index.html"], "INVALID_IDENTITY"],
    ];

    for (const [segments, failure] of cases) {
      const res = await routeGet(segments);
      assert.ok(res.status === 400, `${segments.join("/")} must be refused with 400, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.failure, failure);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
  });

  it("refuses unknown templates, unknown versions and uninventoried assets", async () => {
    const unknownTemplate = await routeGet(["some-other-template", VERSION_A, "index.html"]);
    assert.equal(unknownTemplate.status, 404);
    assert.equal((await unknownTemplate.json()).failure, "MISSING_ARTIFACT");

    const unknownVersion = await routeGet([TEMPLATE_ID, "3.0.0", "index.html"]);
    assert.equal(unknownVersion.status, 404);
    assert.equal((await unknownVersion.json()).failure, "MISSING_ARTIFACT");

    const unknownAsset = await routeGet([TEMPLATE_ID, VERSION_A, "assets/not-in-manifest.js"]);
    assert.equal(unknownAsset.status, 404);
    assert.equal((await unknownAsset.json()).failure, "MISSING_ASSET");
  });

  it("never falls back to a different immutable version", async () => {
    const res = await routeGet([TEMPLATE_ID, "2.5.0", "index.html"]);
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.ok(!text.includes("lifecycle artifact"), "A missing version must not return another release's bytes");
    assert.ok(!text.includes(VERSION_A) && !text.includes(VERSION_B));
  });

  it("fails closed when the release manifest is missing", async () => {
    const root = scratchStorageRoot();
    copyRelease(storageRoot, root, VERSION_A);
    fs.rmSync(path.join(root, "templates", TEMPLATE_ID, VERSION_A, "onevue-manifest.json"));
    setDefaultStorageAdapter(new LocalFilesystemStorageAdapter(root));
    try {
      const res = await routeGet([TEMPLATE_ID, VERSION_A, "index.html"]);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.ok(["MISSING_MANIFEST", "INVALID_MANIFEST"].includes(body.failure), body.failure);
      assert.equal(res.headers.get("cache-control"), "no-store");
    } finally {
      setDefaultStorageAdapter(adapter);
    }
  });

  it("rejects a tampered manifest", async () => {
    const root = scratchStorageRoot();
    copyRelease(storageRoot, root, VERSION_A);
    const manifestPath = path.join(root, "templates", TEMPLATE_ID, VERSION_A, "onevue-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.files[0].sha256 = "0".repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    setDefaultStorageAdapter(new LocalFilesystemStorageAdapter(root));
    try {
      const res = await routeGet([TEMPLATE_ID, VERSION_A, "index.html"]);
      assert.equal(res.status, 503);
      assert.equal((await res.json()).failure, "INVALID_MANIFEST");
    } finally {
      setDefaultStorageAdapter(adapter);
    }
  });

  it("rejects a release whose manifest-declared file has been removed", async () => {
    const root = scratchStorageRoot();
    copyRelease(storageRoot, root, VERSION_A);
    const missingRoot = new LocalFilesystemStorageAdapter(root);

    // Validate successfully first: a cached validation must not mask the loss.
    const first = await missingRoot.validateStoredArtifact(TEMPLATE_ID, VERSION_A);
    assert.equal(first.success, true);
    fs.rmSync(path.join(root, "templates", TEMPLATE_ID, VERSION_A, "assets/index.css"));

    setDefaultStorageAdapter(missingRoot);
    try {
      const asset = await routeGet([TEMPLATE_ID, VERSION_A, "assets/index.css"]);
      assert.equal(asset.status, 503);
      assert.equal((await asset.json()).failure, "INTEGRITY_FAILURE");

      const entrypoint = await routeGet([TEMPLATE_ID, VERSION_A, "index.html"]);
      assert.equal(entrypoint.status, 503, "The whole release must fail closed");
      assert.equal((await entrypoint.json()).failure, "INTEGRITY_FAILURE");
    } finally {
      setDefaultStorageAdapter(adapter);
    }
  });

  it("rejects a tampered asset even when the adapter previously validated the release", async () => {
    const root = scratchStorageRoot();
    copyRelease(storageRoot, root, VERSION_A);
    const tamperedRoot = new LocalFilesystemStorageAdapter(root);

    // A successful validation first, so a cached validation cannot mask tampering.
    const first = await tamperedRoot.validateStoredArtifact(TEMPLATE_ID, VERSION_A);
    assert.equal(first.success, true);

    fs.appendFileSync(path.join(root, "templates", TEMPLATE_ID, VERSION_A, "assets/index.js"), "\n//tampered");
    setDefaultStorageAdapter(tamperedRoot);
    try {
      const res = await routeGet([TEMPLATE_ID, VERSION_A, "assets/index.js"]);
      assert.equal(res.status, 503);
      assert.equal((await res.json()).failure, "INTEGRITY_FAILURE");
    } finally {
      setDefaultStorageAdapter(adapter);
    }
  });

  it("fails closed when artifact storage is unavailable", async () => {
    const unavailable = {
      storeArtifact: async () => {
        throw new Error("not used");
      },
      retrieveArtifact: async () => {
        throw new Error("storage offline");
      },
      checkVersionExists: async () => false,
      validateStoredArtifact: async () => {
        throw new Error("storage offline");
      },
    };
    setDefaultStorageAdapter(unavailable);
    try {
      const res = await routeGet([TEMPLATE_ID, VERSION_A, "index.html"]);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.failure, "STORAGE_UNAVAILABLE");
      assert.match(body.message, /storage offline/);
    } finally {
      setDefaultStorageAdapter(adapter);
    }
  });

  it("exposes the delivery boundary directly with the same decision as the route", async () => {
    const delivery = await deliverTemplateAsset({
      templateId: TEMPLATE_ID,
      templateVersion: VERSION_B,
      relativePath: "index.html",
    });
    assert.equal(delivery.ok, true);
    const boundaryBytes = await readDeliveredAsset(delivery);
    const routeRes = await routeGet([TEMPLATE_ID, VERSION_B, "index.html"]);
    const routeBytes = Buffer.from(await routeRes.arrayBuffer());
    assert.deepEqual(boundaryBytes, routeBytes);
    assert.equal(delivery.manifestSha256, releaseB.result.manifestSha256);
  });
});
