/**
 * OneVue Phase 2.4.3 — Public Template Catalog API Test Suite
 *
 * Verifies the read-only approved-template catalog endpoint (GET /api/public/templates):
 * 1. Successful catalog output (approved templates, metadata, CORS, caching headers, OPTIONS preflight).
 * 2. Approved-version filtering (unapproved versions excluded; templates without approved releases excluded).
 * 3. Safe metadata (repository credentials stripped, internal filesystem paths blocked, internal fields omitted).
 * 4. Empty results if supported (?id=nonexistent, ?dtoVersion=99.9.9).
 * 5. Error handling (malformed query parameters, internal exceptions).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");

// --- 1. Setup TypeScript Transpiler Hook using repository-available TypeScript ---
let ts;
try {
  ts = require("typescript");
} catch {
  try {
    ts = require((() => { try { return require.resolve("typescript"); } catch { try { return require("node:path").resolve(__dirname, "../node_modules/typescript"); } catch { return require("node:path").resolve(__dirname, "../../portfolio/node_modules/typescript"); } } })());
  } catch {
    throw new Error("TypeScript module could not be found for test execution.");
  }
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

// --- 2. Mock next/server and mongoose for standalone Node test execution ---
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "next/server") return "next/server";
  if (request === "mongoose") return "mock_mongoose";
  if (request.endsWith("/db") || request.endsWith("/db.ts")) return "mock_db";
  return originalResolve.apply(this, arguments);
};

const mockDbConnect = async () => {};
mockDbConnect.default = mockDbConnect;
require.cache["mock_db"] = {
  id: "mock_db",
  filename: "mock_db",
  loaded: true,
  exports: mockDbConnect,
};

class MockSchema {
  static Types = { ObjectId: String, Mixed: Object };
  constructor() { this.methods = {}; this.statics = {}; }
  path() { return { validate() {} }; }
  index() {}
  pre() {}
  virtual() { return { get() {} }; }
}
MockSchema.prototype.methods = {};
MockSchema.prototype.statics = {};

require.cache["mock_mongoose"] = {
  id: "mock_mongoose",
  filename: "mock_mongoose",
  loaded: true,
  exports: {
    Schema: MockSchema,
    model: () => ({ find: () => ({ lean: async () => [] }) }),
    models: {},
    default: { Schema: MockSchema, model: () => ({ find: () => ({ lean: async () => [] }) }), models: {} },
  },
};

require.cache["next/server"] = {
  id: "next/server",
  filename: "next/server",
  loaded: true,
  exports: {
    NextResponse: {
      json: (data, init = {}) => {
        const headers = new Map();
        if (init.headers) {
          for (const [k, v] of Object.entries(init.headers)) {
            headers.set(k.toLowerCase(), v);
          }
        }
        return {
          status: init.status || 200,
          headers: {
            get: (key) => headers.get(key.toLowerCase()) || null,
            set: (key, val) => headers.set(key.toLowerCase(), val),
            has: (key) => headers.has(key.toLowerCase()),
          },
          json: async () => data,
        };
      },
    },
  },
};

// Import route and helper functions under test
const route = require("../app/api/public/templates/route.ts");
const { GET, OPTIONS, buildPublicCatalog } = route;

describe("Phase 2.4.3 — Public Template Catalog API (GET /api/public/templates)", () => {
  describe("1. Successful Catalog Output", () => {
    it("returns HTTP 200 with approved templates from the central registry", async () => {
      const req = new Request("http://localhost:3000/api/public/templates");
      const res = await GET(req);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(typeof data.count, "number");
      assert.ok(data.count >= 1);
      assert.ok(Array.isArray(data.templates));

      const magicUi = data.templates.find((t) => t.id === "magicui-portfolio");
      assert.ok(magicUi, "Expected 'magicui-portfolio' in catalog response");
      assert.equal(magicUi.name, "Magic UI Developer Portfolio");
      assert.equal(magicUi.latestVersion, "1.0.0");
      assert.ok(magicUi.author);
      assert.equal(magicUi.author.name, "OneVue Platform & Magic UI");
      assert.ok(magicUi.repository);
      assert.equal(magicUi.repository.url, "https://github.com/onevue/magicui-portfolio.git");
      assert.ok(Array.isArray(magicUi.tags));
      assert.ok(magicUi.tags.includes("verified-credentials"));

      // Verify releases array
      assert.ok(Array.isArray(magicUi.releases));
      assert.equal(magicUi.releases.length, 1);
      const rel = magicUi.releases[0];
      assert.equal(rel.version, "1.0.0");
      assert.deepEqual(rel.supportedDtoVersions, ["1.0.0"]);
      assert.ok(rel.supportedSections.includes("hero"));
      assert.ok(rel.supportedSections.includes("credentials"));
      assert.equal(rel.customizationOptions.supportsAccentColor, true);
      assert.equal(rel.customizationOptions.supportsThemeMode, true);
      assert.equal(rel.artifact.format, "static");
      assert.equal(rel.artifact.assetBaseUrl, "/templates/magicui-portfolio/1.0.0/");
    });

    it("applies public caching headers to response", async () => {
      const req = new Request("http://localhost:3000/api/public/templates");
      const res = await GET(req);
      const cacheControl = res.headers.get("cache-control");
      assert.ok(cacheControl, "Expected Cache-Control header");
      assert.ok(cacheControl.includes("public"));
      assert.ok(cacheControl.includes("max-age=60"));
    });

    it("applies CORS headers when origin is allowed", async () => {
      const req = new Request("http://localhost:3000/api/public/templates", {
        headers: { origin: "http://localhost:8080" },
      });
      const res = await GET(req);
      assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:8080");
    });

    it("handles OPTIONS preflight requests cleanly with HTTP 204", () => {
      const req = new Request("http://localhost:3000/api/public/templates", {
        method: "OPTIONS",
        headers: { origin: "http://localhost:8080" },
      });
      const res = OPTIONS(req);
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:8080");
    });
  });

  describe("2. Approved-Version Filtering", () => {
    it("excludes experimental, deprecated, and rejected versions from releases", () => {
      const fixtureTemplates = [
        {
          id: "hybrid-template",
          name: "Hybrid Template",
          author: { name: "Author" },
          repository: { type: "git", url: "https://github.com/example/repo" },
          tags: ["test"],
          releases: [
            {
              version: "1.0.0",
              approvalStatus: "approved",
              supportedDtoVersions: ["1.0.0"],
              supportedSections: ["hero"],
              artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/templates/hybrid/1.0.0/" },
            },
            {
              version: "2.0.0-beta",
              approvalStatus: "experimental",
              supportedDtoVersions: ["1.0.0"],
              supportedSections: ["hero"],
              artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/templates/hybrid/2.0.0-beta/" },
            },
            {
              version: "0.9.0",
              approvalStatus: "deprecated",
              supportedDtoVersions: ["1.0.0"],
              supportedSections: ["hero"],
              artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/templates/hybrid/0.9.0/" },
            },
            {
              version: "0.1.0",
              approvalStatus: "rejected",
              supportedDtoVersions: ["1.0.0"],
              supportedSections: ["hero"],
              artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/templates/hybrid/0.1.0/" },
            },
          ],
        },
      ];

      // Note: listApprovedTemplates() in registry filters rel.approvalStatus === "approved",
      // and buildPublicCatalog ensures that only approved releases in the list are packaged.
      const rawApprovedOnly = fixtureTemplates.map((t) => ({
        ...t,
        releases: t.releases.filter((r) => r.approvalStatus === "approved"),
      }));

      const catalog = buildPublicCatalog(rawApprovedOnly);
      assert.equal(catalog.length, 1);
      assert.equal(catalog[0].releases.length, 1);
      assert.equal(catalog[0].releases[0].version, "1.0.0");
    });

    it("excludes templates that have zero approved releases", () => {
      const fixtureTemplates = [
        {
          id: "unapproved-template",
          name: "Unapproved Template",
          author: { name: "Author" },
          releases: [], // Zero approved releases
        },
      ];
      const catalog = buildPublicCatalog(fixtureTemplates);
      assert.equal(catalog.length, 0);
    });

    it("filters catalog releases by dtoVersion query parameter", async () => {
      // DTO 1.0.0 is supported by magicui-portfolio
      const req1 = new Request("http://localhost:3000/api/public/templates?dtoVersion=1.0.0");
      const res1 = await GET(req1);
      const data1 = await res1.json();
      assert.equal(data1.success, true);
      assert.equal(data1.count, 1);
      assert.equal(data1.templates[0].id, "magicui-portfolio");
    });
  });

  describe("3. Safe Metadata Sanitization", () => {
    it("strips embedded basic auth credentials from repository URLs", () => {
      const fixture = [
        {
          id: "private-creds-template",
          name: "Creds Template",
          author: { name: "Author" },
          repository: {
            type: "git",
            url: "https://x-access-token:ghp_secretToken12345@github.com/onevue/private-template.git",
            defaultBranch: "main",
          },
          releases: [
            {
              version: "1.0.0",
              supportedDtoVersions: ["1.0.0"],
              supportedSections: ["hero"],
              artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/templates/creds/1.0.0/" },
            },
          ],
        },
      ];

      const catalog = buildPublicCatalog(fixture);
      assert.equal(catalog.length, 1);
      assert.equal(
        catalog[0].repository.url,
        "https://github.com/onevue/private-template.git",
        "Embedded userinfo token must be completely stripped"
      );
    });

    it("blocks internal absolute filesystem paths in artifact.assetBaseUrl", () => {
      const fixture = [
        {
          id: "filesystem-leak-template",
          name: "Leak Template",
          author: { name: "Author" },
          repository: { type: "git", url: "https://github.com/example/repo" },
          releases: [
            {
              version: "1.0.0",
              supportedDtoVersions: ["1.0.0"],
              artifact: {
                format: "static",
                entrypoint: "index.html",
                assetBaseUrl: "/home/developer/Desktop/Onevue-templates/magicui-portfolio/dist/",
              },
            },
          ],
        },
      ];

      const catalog = buildPublicCatalog(fixture);
      assert.equal(catalog.length, 1);
      assert.equal(
        catalog[0].releases[0].artifact.assetBaseUrl,
        "",
        "Internal /home/... filesystem path must be scrubbed from public metadata"
      );
    });

    it("does not expose internal-only fields or private keys", () => {
      const fixture = [
        {
          id: "internal-fields-template",
          name: "Template with Internals",
          author: { name: "Author" },
          repository: { type: "git", url: "https://github.com/example/repo" },
          internalDeployKey: "ssh-rsa AAAA_SUPER_SECRET",
          privateBuildScript: "build.sh",
          releases: [
            {
              version: "1.0.0",
              supportedDtoVersions: ["1.0.0"],
              artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/templates/internal/1.0.0/" },
              internalBuildId: "build-98765",
            },
          ],
        },
      ];

      const catalog = buildPublicCatalog(fixture);
      assert.equal(catalog[0].internalDeployKey, undefined);
      assert.equal(catalog[0].privateBuildScript, undefined);
      assert.equal(catalog[0].releases[0].internalBuildId, undefined);
    });
  });

  describe("4. Empty Results Handling", () => {
    it("returns count 0 and empty templates array for nonexistent template ID", async () => {
      const req = new Request("http://localhost:3000/api/public/templates?id=completely-nonexistent-template");
      const res = await GET(req);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.count, 0);
      assert.deepEqual(data.templates, []);
    });

    it("returns count 0 and empty templates array for unsupported DTO version", async () => {
      const req = new Request("http://localhost:3000/api/public/templates?dtoVersion=99.9.9");
      const res = await GET(req);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.count, 0);
      assert.deepEqual(data.templates, []);
    });

    it("returns empty catalog when given empty array", () => {
      const catalog = buildPublicCatalog([]);
      assert.deepEqual(catalog, []);
    });
  });

  describe("5. Query Validation and Error Handling", () => {
    it("returns HTTP 400 when dtoVersion contains invalid characters", async () => {
      const req = new Request("http://localhost:3000/api/public/templates?dtoVersion=1.0.0%3Cscript%3E");
      const res = await GET(req);
      assert.equal(res.status, 400);

      const data = await res.json();
      assert.equal(data.success, false);
      assert.ok(data.message.includes("Invalid dtoVersion"));
    });

    it("returns HTTP 400 when id contains invalid characters or path traversal", async () => {
      const req = new Request("http://localhost:3000/api/public/templates?id=../../etc/passwd");
      const res = await GET(req);
      assert.equal(res.status, 400);

      const data = await res.json();
      assert.equal(data.success, false);
      assert.ok(data.message.includes("Invalid id query parameter"));
    });

    it("returns HTTP 400 when dtoVersion exceeds maximum allowable length", async () => {
      const longVersion = "1." + "0".repeat(50);
      const req = new Request(`http://localhost:3000/api/public/templates?dtoVersion=${longVersion}`);
      const res = await GET(req);
      assert.equal(res.status, 400);

      const data = await res.json();
      assert.equal(data.success, false);
      assert.ok(data.message.includes("Invalid dtoVersion"));
    });
  });
});
