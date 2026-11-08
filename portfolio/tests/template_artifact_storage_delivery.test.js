/**
 * =========================================================================
 * OneVue Phase 5.14 — Portfolio Consumer of the Backend Artifact Boundary
 * =========================================================================
 *
 * The portfolio asset route must consume the backend's authoritative artifact
 * delivery boundary and add no storage rules of its own. These tests exercise
 * that consumption in both transports:
 *
 *   A. Direct (local development, backend not a separate process):
 *      route -> backend delivery boundary (in-process) -> storage adapter
 *
 *   B. HTTP (backend running as its own service):
 *      route -> HTTP -> real backend route handler -> boundary -> adapter
 *      The HTTP server below executes the ACTUAL backend Next.js handler, so
 *      the proxied leg is contract-faithful rather than a hand-written mock.
 *
 * Covered: exact bytes and immutable version pinning, two versions without
 * collisions, integrity failures, traversal/absolute paths, missing
 * artifact/asset, unknown template/version, backend unavailable (fail closed,
 * no fallback), MagicUI backward compatibility, content type and cache headers.
 *
 * Fixtures are produced by the repository's packaging + storage pipeline
 * (verifyAndPackageArtifact -> LocalFilesystemStorageAdapter.storeArtifact),
 * never by hand-written manifests.
 */

const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const Module = require("node:module");

const PORTFOLIO_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PORTFOLIO_ROOT, "..");

// ---------------------------------------------------------------------------
// Transpile hook + "@/" alias resolution for the portfolio application code.
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

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalResolve.call(this, path.join(PORTFOLIO_ROOT, "src", request.slice(2)), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

if (!/portfolio[\\/]node_modules/.test(process.env.NODE_PATH || "")) {
  process.env.NODE_PATH = [path.join(PORTFOLIO_ROOT, "node_modules"), process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();
}

const {
  resolveTemplateAsset,
  resolveTemplateRelease,
  resolveTemplateEntrypointHtml,
  setArtifactStorageAdapter,
  resolveBackendArtifactBaseUrl,
  BACKEND_ARTIFACT_API_PREFIX,
} = require("../src/lib/template-artifact-store.ts");
const templateAssetRoute = require("../src/app/templates/[...path]/route.ts");
const {
  seedLocalTemplateArtifact,
} = require("../../backend/lib/template-local-delivery.ts");
const {
  LocalFilesystemStorageAdapter,
} = require("../../backend/lib/template-storage.ts");
const { setDefaultStorageAdapter } = require("../../backend/lib/template-artifact-delivery.ts");
const backendRoute = require("../../backend/app/api/public/template-artifact/[...path]/route.ts");

const TEMPLATE_ID = "consumer-template";
const VERSION_A = "2.0.0";
const VERSION_B = "2.1.0";
const BUILTIN_ID = "magicui-portfolio";
const BUILTIN_VERSION = "1.0.0";

function assetRouteGet(segments) {
  return templateAssetRoute.GET(new Request(`http://localhost/templates/${segments.join("/")}`), {
    params: Promise.resolve({ path: segments }),
  });
}

function writeSourceArtifact(root, version, extra = {}) {
  const dir = path.join(root, `source-${version.replace(/\./g, "-")}`);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><!-- <script type="application/json" id="__ONEVUE_DTO__">{}</script> --><script type="module" src="/templates/${TEMPLATE_ID}/${version}/assets/index.js"></script><link rel="stylesheet" href="/templates/${TEMPLATE_ID}/${version}/assets/index.css"></head><body>${extra.htmlMarker || ""}<div id="root"></div></body></html>`
  );
  fs.writeFileSync(path.join(dir, "assets", "index.js"), `console.log("artifact ${version}");`);
  fs.writeFileSync(path.join(dir, "assets", "index.css"), `body{--v:"${version}"}`);
  return dir;
}

async function seed(adapter, version) {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-514-consumer-src-"));
  const sourceDir = writeSourceArtifact(sourceRoot, version, { htmlMarker: `<!-- ${version} -->` });
  const result = await seedLocalTemplateArtifact({
    sourceArtifactDir: sourceDir,
    templateId: TEMPLATE_ID,
    templateVersion: version,
    sourceCommitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
    supportedDtoVersions: ["1.0.0"],
    storageAdapter: adapter,
  });
  return { result, sourceRoot };
}

/** HTTP server executing the REAL backend route handler. */
async function startBackendHttpServer(storageAdapter) {
  setDefaultStorageAdapter(storageAdapter);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (!url.pathname.startsWith(BACKEND_ARTIFACT_API_PREFIX + "/")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, failure: "MISSING_ARTIFACT" }));
        return;
      }
      const segments = url.pathname
        .slice(BACKEND_ARTIFACT_API_PREFIX.length + 1)
        .split("/")
        .filter((s) => s.length > 0)
        .map(decodeURIComponent);

      let response;
      try {
        response = await backendRoute.GET(new Request(url.toString()), {
          params: Promise.resolve({ path: segments }),
        });
      } catch (err) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, failure: "STORAGE_UNAVAILABLE", message: String(err) }));
        return;
      }
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, headers);
      res.end(body);
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, message: String(err) }));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("Phase 5.14 — portfolio consumes the backend artifact boundary", () => {
  let storageRoot;
  let adapter;
  let sourceRoots = [];
  const originalBackendUrl = process.env.ONEVUE_BACKEND_URL;
  const originalArtifactUrl = process.env.ONEVUE_BACKEND_ARTIFACT_BASE_URL;

  before(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-514-consumer-storage-"));
    adapter = new LocalFilesystemStorageAdapter(storageRoot);
    setArtifactStorageAdapter(adapter);

    for (const version of [VERSION_A, VERSION_B]) {
      const { result, sourceRoot } = await seed(adapter, version);
      assert.equal(result.outcome, "SEEDED", result.error);
      sourceRoots.push(sourceRoot);
    }
  });

  after(() => {
    setArtifactStorageAdapter(null);
    setDefaultStorageAdapter(null);
    if (originalBackendUrl === undefined) delete process.env.ONEVUE_BACKEND_URL;
    else process.env.ONEVUE_BACKEND_URL = originalBackendUrl;
    if (originalArtifactUrl === undefined) delete process.env.ONEVUE_BACKEND_ARTIFACT_BASE_URL;
    else process.env.ONEVUE_BACKEND_ARTIFACT_BASE_URL = originalArtifactUrl;

    for (const root of [storageRoot, ...sourceRoots]) {
      if (root && fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    delete process.env.ONEVUE_BACKEND_URL;
    delete process.env.ONEVUE_BACKEND_ARTIFACT_BASE_URL;
    setArtifactStorageAdapter(adapter);
  });

  /* ---------------------------------------------------------------------
     A. Direct transport
     --------------------------------------------------------------------- */

  describe("direct transport", () => {
    it("serves the stored artifact bytes for the exact requested version", async () => {
      const res = await assetRouteGet([TEMPLATE_ID, VERSION_A, "index.html"]);
      assert.equal(res.status, 200);
      const body = Buffer.from(await res.arrayBuffer());
      const stored = fs.readFileSync(
        path.join(storageRoot, "templates", TEMPLATE_ID, VERSION_A, "index.html")
      );
      assert.deepEqual(body, stored);
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(res.headers.get("x-onevue-template-id"), TEMPLATE_ID);
      assert.equal(res.headers.get("x-onevue-template-version"), VERSION_A);
      assert.equal(res.headers.get("x-onevue-artifact-transport"), "direct");
    });

    it("keeps two versions isolated with no asset collision", async () => {
      const a = await assetRouteGet([TEMPLATE_ID, VERSION_A, "assets/index.js"]);
      const b = await assetRouteGet([TEMPLATE_ID, VERSION_B, "assets/index.js"]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal((await a.text()), `console.log("artifact ${VERSION_A}");`);
      assert.equal((await b.text()), `console.log("artifact ${VERSION_B}");`);
    });

    it("pins the release identity rather than substituting a neighbour", async () => {
      const release = await resolveTemplateRelease(TEMPLATE_ID, VERSION_B);
      assert.equal(release.resolution.ok, true, release.resolution.error);
      assert.equal(release.release.templateVersion, VERSION_B);

      const missing = await resolveTemplateRelease(TEMPLATE_ID, "9.9.9");
      assert.equal(missing.resolution.ok, false);
      assert.equal(missing.resolution.failure, "MISSING_ARTIFACT");

      const res = await assetRouteGet([TEMPLATE_ID, "9.9.9", "assets/index.js"]);
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.failure, "MISSING_ARTIFACT");
      assert.ok(!JSON.stringify(body).includes("console.log("), "No other release may be served");
    });

    it("rejects traversal, absolute paths, unknown template/version and missing assets", async () => {
      const traversal = await assetRouteGet([TEMPLATE_ID, VERSION_A, "..", "onevue-manifest.json"]);
      assert.equal(traversal.status, 400);
      assert.equal((await traversal.json()).failure, "UNSAFE_PATH");
      assert.equal(traversal.headers.get("cache-control"), "no-store");

      const nestedTraversal = await assetRouteGet([
        TEMPLATE_ID,
        VERSION_A,
        "assets/../../onevue-manifest.json",
      ]);
      assert.equal(nestedTraversal.status, 400);

      const missingAsset = await assetRouteGet([TEMPLATE_ID, VERSION_A, "assets/unknown.js"]);
      assert.equal(missingAsset.status, 404);
      assert.equal((await missingAsset.json()).failure, "MISSING_ASSET");

      const unknownVersion = await assetRouteGet([TEMPLATE_ID, "0.0.1", "index.html"]);
      assert.equal(unknownVersion.status, 404);
      assert.equal((await unknownVersion.json()).failure, "MISSING_ARTIFACT");

      const unknownTemplate = await assetRouteGet(["nope-template", VERSION_A, "index.html"]);
      assert.equal(unknownTemplate.status, 404);
      assert.equal((await unknownTemplate.json()).failure, "MISSING_ARTIFACT");
    });

    it("rejects a tampered stored asset with an integrity failure", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-514-consumer-tamper-"));
      try {
        fs.cpSync(
          path.join(storageRoot, "templates", TEMPLATE_ID, VERSION_A),
          path.join(root, "templates", TEMPLATE_ID, VERSION_A),
          { recursive: true }
        );
        fs.appendFileSync(
          path.join(root, "templates", TEMPLATE_ID, VERSION_A, "assets", "index.js"),
          "\n//tampered"
        );

        const tamperedAdapter = new LocalFilesystemStorageAdapter(root);
        setArtifactStorageAdapter(tamperedAdapter);

        const res = await assetRouteGet([TEMPLATE_ID, VERSION_A, "assets/index.js"]);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).failure, "INTEGRITY_FAILURE");
      } finally {
        setArtifactStorageAdapter(adapter);
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("delivers the entrypoint document used for rendering", async () => {
      const entrypoint = await resolveTemplateEntrypointHtml(TEMPLATE_ID, VERSION_A);
      assert.equal(entrypoint.resolution.ok, true, entrypoint.resolution.error);
      assert.ok(entrypoint.html.startsWith("<!DOCTYPE html>"));
      assert.equal(entrypoint.release.templateVersion, VERSION_A);
      assert.equal(entrypoint.release.transport, "direct");

      const storedManifest = JSON.parse(
        fs.readFileSync(
          path.join(storageRoot, "templates", TEMPLATE_ID, VERSION_A, "onevue-manifest.json"),
          "utf8"
        )
      );
      assert.equal(
        entrypoint.release.manifestSha256,
        storedManifest.manifestSha256,
        "The delivered entrypoint must carry the validated manifest checksum as provenance"
      );
    });

    it("keeps MagicUI backward compatible from the bundled directory", async () => {
      const res = await assetRouteGet([BUILTIN_ID, BUILTIN_VERSION, "index.html"]);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('<div id="root"></div>'));
      assert.equal(res.headers.get("x-onevue-artifact-transport"), "bundled");

      const badVersion = await assetRouteGet([BUILTIN_ID, "9.9.9", "index.html"]);
      assert.equal(badVersion.status, 404);

      const traversal = await assetRouteGet([BUILTIN_ID, BUILTIN_VERSION, "..", "..", "index.html"]);
      assert.equal(traversal.status, 400);
    });
  });

  /* ---------------------------------------------------------------------
     B. HTTP transport against the real backend handler
     --------------------------------------------------------------------- */

  describe("HTTP transport (real backend route handler)", () => {
    let server;
    let baseUrl;

    before(async () => {
      const started = await startBackendHttpServer(adapter);
      server = started.server;
      baseUrl = started.baseUrl;
    });

    after(() => {
      if (server) server.close();
      setDefaultStorageAdapter(null);
    });

    beforeEach(() => {
      process.env.ONEVUE_BACKEND_ARTIFACT_BASE_URL = baseUrl;
    });

    it("proxies bytes, content type and cache headers from the backend API", async () => {
      assert.equal(resolveBackendArtifactBaseUrl(), baseUrl);

      const res = await assetRouteGet([TEMPLATE_ID, VERSION_A, "index.html"]);
      assert.equal(res.status, 200);
      const body = Buffer.from(await res.arrayBuffer());
      const stored = fs.readFileSync(
        path.join(storageRoot, "templates", TEMPLATE_ID, VERSION_A, "index.html")
      );
      assert.deepEqual(body, stored);
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(res.headers.get("x-onevue-artifact-transport"), "http");
    });

    it("forwards backend refusals without falling back to local storage", async () => {
      // The artifact exists in the adapter, but the requested version does not:
      // the backend's 404 must be forwarded, not silently resolved locally.
      const unknown = await assetRouteGet([TEMPLATE_ID, "9.9.9", "index.html"]);
      assert.equal(unknown.status, 404);
      assert.equal((await unknown.json()).failure, "MISSING_ARTIFACT");

      const traversal = await assetRouteGet([TEMPLATE_ID, VERSION_A, "..", "onevue-manifest.json"]);
      assert.equal(traversal.status, 400);
      assert.equal((await traversal.json()).failure, "UNSAFE_PATH");

      const missingAsset = await assetRouteGet([TEMPLATE_ID, VERSION_A, "assets/nope.js"]);
      assert.equal(missingAsset.status, 404);
    });

    it("fails closed when the backend is unreachable", async () => {
      const closed = http.createServer();
      await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const { port } = closed.address();
      await new Promise((resolve) => closed.close(resolve));

      process.env.ONEVUE_BACKEND_ARTIFACT_BASE_URL = `http://127.0.0.1:${port}`;

      const res = await assetRouteGet([TEMPLATE_ID, VERSION_A, "index.html"]);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.failure, "STORAGE_UNAVAILABLE");
      assert.equal(res.headers.get("cache-control"), "no-store");
    });

    it("surfaces backend integrity failures over HTTP", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-514-http-tamper-"));
      try {
        fs.cpSync(
          path.join(storageRoot, "templates", TEMPLATE_ID, VERSION_A),
          path.join(root, "templates", TEMPLATE_ID, VERSION_A),
          { recursive: true }
        );
        fs.appendFileSync(
          path.join(root, "templates", TEMPLATE_ID, VERSION_A, "assets", "index.css"),
          "/* tampered */"
        );
        setDefaultStorageAdapter(new LocalFilesystemStorageAdapter(root));

        const res = await assetRouteGet([TEMPLATE_ID, VERSION_A, "assets/index.css"]);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).failure, "INTEGRITY_FAILURE");
      } finally {
        setDefaultStorageAdapter(adapter);
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("resolves the release and entrypoint through the HTTP transport", async () => {
      const release = await resolveTemplateRelease(TEMPLATE_ID, VERSION_B);
      assert.equal(release.resolution.ok, true, release.resolution.error);
      assert.equal(release.release.transport, "http");

      const entrypoint = await resolveTemplateEntrypointHtml(TEMPLATE_ID, VERSION_B);
      assert.equal(entrypoint.resolution.ok, true);
      assert.ok(entrypoint.html.includes(`/templates/${TEMPLATE_ID}/${VERSION_B}/assets/`));
    });
  });
});
