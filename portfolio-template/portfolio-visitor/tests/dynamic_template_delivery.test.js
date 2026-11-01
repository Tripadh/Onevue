/**
 * =========================================================================
 * OneVue Phase 5.14 — Browser Delivery Regression Tests
 * =========================================================================
 *
 * Focused regression coverage for the three genuine blockers found during
 * Phase 5.14 local browser verification:
 *
 * 1. Artifact integrity: a dynamic template release must ship a manifest whose
 *    file inventory, per-file SHA-256 digests, byte totals and self-checksum
 *    are all valid. A malformed manifest must be rejected by the platform's
 *    own integrity rules.
 *
 * 2. Asset path isolation: a dynamic template must reference its OWN
 *    versioned asset directory. Serving another template's assets would
 *    silently deliver the wrong release and break version pinning.
 *
 * 3. Route-level 404 semantics: the public profile route must resolve the
 *    published snapshot before the segment loading boundary flushes the
 *    response shell, so unpublished profiles commit HTTP 404 rather than
 *    HTTP 200 with a not-found body.
 *
 * These tests are filesystem + source level: they assert the properties that
 * browser verification proved, without requiring a running Next.js server.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

// Load the backend/portfolio TypeScript modules through the same transpile
// hook the backend test suite uses: the artifact delivery boundary is owned by
// the backend, so the tests exercise that module rather than a copy of it.
{
  const ts = require(
    "/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript"
  );
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
}

const TEMPLATES_ROOT = path.resolve(__dirname, "../public/templates");
const DYNAMIC_TEMPLATE_ID = "community-template";
const DYNAMIC_TEMPLATE_VERSION = "1.1.0";
const STATIC_TEMPLATE_ID = "magicui-portfolio";
const STATIC_TEMPLATE_VERSION = "1.0.0";

const {
  resolveTemplateArtifactsRoot,
} = require("../../backend/lib/template-storage.ts");

const {
  resolveTemplateRelease,
  resolveTemplateEntrypointHtml,
} = require("../src/lib/template-artifact-store.ts");

/**
 * Phase 5.13 — the dynamic template release lives in the BACKEND artifact
 * storage, not in an independently copied fixture inside the portfolio app.
 * The built-in MagicUI template still ships with the portfolio application
 * under public/templates.
 */
const DYNAMIC_ARTIFACTS_ROOT = resolveTemplateArtifactsRoot();

function dynamicTemplateDir(templateId = DYNAMIC_TEMPLATE_ID, version = DYNAMIC_TEMPLATE_VERSION) {
  return path.join(DYNAMIC_ARTIFACTS_ROOT, templateId, version);
}

/**
 * Reimplements the platform's manifest integrity rules
 * (backend/lib/template-storage.ts :: validateManifestStructure) so the
 * portfolio-side fixture is held to the same contract as stored artifacts.
 */
function validateManifestStructure(templateId, version, manifest) {
  if (!manifest || manifest.templateId !== templateId || manifest.templateVersion !== version) {
    return "Manifest template identity does not match the requested artifact.";
  }
  if (
    manifest.entrypoint !== "index.html" ||
    !Array.isArray(manifest.supportedDtoVersions) ||
    manifest.supportedDtoVersions.length === 0 ||
    manifest.supportedDtoVersions.some((value) => typeof value !== "string")
  ) {
    return "Manifest schema metadata is invalid.";
  }
  if (
    !Array.isArray(manifest.files) ||
    !Number.isSafeInteger(manifest.totalFiles) ||
    manifest.files.length !== manifest.totalFiles
  ) {
    return "Manifest file inventory is invalid.";
  }

  const seen = new Set();
  for (const file of manifest.files) {
    const relativePath =
      typeof file.relativePath === "string" ? file.relativePath.replace(/\\/g, "/") : "";
    if (
      !relativePath ||
      relativePath === "onevue-manifest.json" ||
      relativePath.startsWith("/") ||
      relativePath.split("/").includes("..")
    ) {
      return `Manifest contains an unsafe relative path: '${file.relativePath}'.`;
    }
    if (
      seen.has(relativePath) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes < 0
    ) {
      return "Manifest contains an invalid or duplicate file entry.";
    }
    seen.add(relativePath);
  }

  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0) {
    return "Manifest totalBytes is invalid.";
  }
  if (!manifest.manifestSha256 || computeManifestChecksum(manifest) !== manifest.manifestSha256) {
    return "Manifest cryptographic checksum verification failed.";
  }
  return undefined;
}

/** Mirrors backend/lib/template-storage.ts :: computeManifestChecksum. */
function computeManifestChecksum(manifest) {
  const copy = { ...manifest };
  delete copy.manifestSha256;
  const json = JSON.stringify(copy, Object.keys(copy).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

describe("OneVue Phase 5.14 — Dynamic Template Artifact Integrity", () => {
  it("ships a dynamic template release with a structurally valid manifest", () => {
    const dir = dynamicTemplateDir();
    const manifestPath = path.join(dir, "onevue-manifest.json");

    assert.ok(fs.existsSync(manifestPath), "Dynamic template release must ship a release manifest");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const error = validateManifestStructure(DYNAMIC_TEMPLATE_ID, DYNAMIC_TEMPLATE_VERSION, manifest);

    assert.equal(error, undefined, `Dynamic template manifest must be structurally valid: ${error}`);
  });

  it("declares every packaged file with a matching SHA-256 digest and byte size", () => {
    const dir = dynamicTemplateDir();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "onevue-manifest.json"), "utf8")
    );

    let totalBytes = 0;
    for (const file of manifest.files) {
      const filePath = path.join(dir, file.relativePath);
      assert.ok(fs.existsSync(filePath), `Declared file must exist on disk: ${file.relativePath}`);

      const contents = fs.readFileSync(filePath);
      const actualSha256 = crypto.createHash("sha256").update(contents).digest("hex");

      assert.equal(
        actualSha256,
        file.sha256,
        `SHA-256 mismatch for declared file: ${file.relativePath}`
      );
      assert.equal(
        contents.length,
        file.sizeBytes,
        `Size mismatch for declared file: ${file.relativePath}`
      );

      totalBytes += contents.length;
    }

    assert.equal(
      totalBytes,
      manifest.totalBytes,
      "Manifest totalBytes must equal the sum of the declared file sizes"
    );
  });

  it("keeps the manifest checksum self-consistent", () => {
    const dir = dynamicTemplateDir();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "onevue-manifest.json"), "utf8")
    );

    assert.equal(
      computeManifestChecksum(manifest),
      manifest.manifestSha256,
      "Manifest self-checksum must verify against the canonical checksum algorithm"
    );
  });

  it("rejects a manifest whose file inventory does not match its declared count", () => {
    const dir = dynamicTemplateDir();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "onevue-manifest.json"), "utf8")
    );

    const corrupted = { ...manifest, totalFiles: manifest.files.length + 1 };
    const error = validateManifestStructure(
      DYNAMIC_TEMPLATE_ID,
      DYNAMIC_TEMPLATE_VERSION,
      corrupted
    );

    assert.equal(error, "Manifest file inventory is invalid.");
  });

  it("rejects a manifest whose per-file digest does not match the packaged bytes", () => {
    const dir = dynamicTemplateDir();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "onevue-manifest.json"), "utf8")
    );

    const corrupted = {
      ...manifest,
      files: manifest.files.map((file) =>
        file.relativePath === "index.html"
          ? { ...file, sha256: "0".repeat(64) }
          : file
      ),
    };

    // The manifest checksum covers release metadata only; per-file digests are
    // verified independently against the bytes actually present on disk.
    // Reproduce that per-file verification and assert it rejects the forgery.
    const verificationErrors = [];
    for (const file of corrupted.files) {
      const filePath = path.join(dir, file.relativePath);
      if (!fs.existsSync(filePath)) {
        verificationErrors.push(`missing: ${file.relativePath}`);
        continue;
      }
      const actualSha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex");
      if (actualSha256 !== file.sha256) {
        verificationErrors.push(`digest mismatch: ${file.relativePath}`);
      }
    }

    assert.deepEqual(
      verificationErrors,
      ["digest mismatch: index.html"],
      "A forged per-file digest must be rejected by disk-backed verification"
    );
  });
});

describe("OneVue Phase 5.14 — Versioned Asset Path Isolation", () => {
  it("serves the dynamic template from its own versioned asset directory", () => {
    const dir = dynamicTemplateDir();
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

    const expectedBase = `/templates/${DYNAMIC_TEMPLATE_ID}/${DYNAMIC_TEMPLATE_VERSION}/assets/`;
    assert.ok(
      html.includes(expectedBase),
      `Dynamic template must reference its own versioned assets at '${expectedBase}'`
    );

    const foreignRefs = html.match(/\/templates\/[a-z0-9_-]+\/[0-9.]+\/assets\//g) || [];
    for (const ref of foreignRefs) {
      assert.equal(
        ref,
        expectedBase,
        `Dynamic template must not reference another template's assets: '${ref}'`
      );
    }
  });

  it("keeps every asset referenced by the dynamic template present on disk", () => {
    const dir = dynamicTemplateDir();
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

    const refs = html.match(/\/templates\/[^"']+\/assets\/[^"']+/g) || [];
    assert.ok(refs.length > 0, "Dynamic template entrypoint must reference built assets");

    for (const ref of refs) {
      // Asset URLs are served by the template asset route
      // (/templates/<id>/<ver>/assets/x.js), which resolves them against the
      // backend artifact storage for dynamic releases.
      const relativePath = ref.replace(/^\/templates\//, "");
      const assetPath = path.join(DYNAMIC_ARTIFACTS_ROOT, relativePath);
      assert.ok(
        fs.existsSync(assetPath),
        `Referenced asset must exist in the backend artifact storage: ${relativePath}`
      );
    }
  });

  it("leaves the built-in static template on its own versioned asset path", () => {
    const dir = path.join(TEMPLATES_ROOT, STATIC_TEMPLATE_ID, STATIC_TEMPLATE_VERSION);
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

    const expectedBase = `/templates/${STATIC_TEMPLATE_ID}/${STATIC_TEMPLATE_VERSION}/assets/`;
    assert.ok(
      html.includes(expectedBase),
      `Static template must reference its own versioned assets at '${expectedBase}'`
    );
  });
});

describe("OneVue Phase 5.14 — Application Icon Integrity", () => {
  it("ships a favicon whose embedded PNG payload is byte-intact", () => {
    const faviconPath = path.resolve(__dirname, "../src/app/favicon.ico");
    assert.ok(fs.existsSync(faviconPath), "The application must ship a favicon.ico");

    const data = fs.readFileSync(faviconPath);

    // ICO header: reserved(2) = 0, type(2) = 1, imageCount(2)
    assert.equal(data.readUInt16LE(0), 0, "ICO reserved field must be zero");
    assert.equal(data.readUInt16LE(2), 1, "ICO type field must be 1 (icon)");
    const imageCount = data.readUInt16LE(4);
    assert.ok(imageCount > 0, "ICO must declare at least one image");

    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    for (let index = 0; index < imageCount; index++) {
      const entryOffset = 6 + index * 16;
      const size = data.readUInt32LE(entryOffset + 8);
      const imageOffset = data.readUInt32LE(entryOffset + 12);

      assert.ok(
        imageOffset + size <= data.length,
        `ICO entry ${index} must not be truncated by the file length`
      );

      const payload = data.slice(imageOffset, imageOffset + size);

      if (!payload.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
        continue; // BMP-compressed entry: no PNG chunk structure to validate.
      }

      // A PNG payload must carry the complete 8-byte signature. A missing
      // 0x0D byte (CRLF -> LF conversion of a binary file) makes decoders
      // fall back to BMP parsing and abort the Next.js compilation.
      assert.ok(
        payload.slice(0, 8).equals(PNG_SIGNATURE),
        `ICO entry ${index} embeds a PNG with a corrupted signature`
      );

      // Every PNG chunk must still satisfy its own CRC.
      let position = 8;
      while (position + 8 <= payload.length) {
        const length = payload.readUInt32BE(position);
        const chunkType = payload.slice(position + 4, position + 8);
        assert.ok(
          /^[A-Za-z]{4}$/.test(chunkType.toString("ascii")),
          `ICO entry ${index} contains a malformed PNG chunk header`
        );

        const chunkData = payload.slice(position + 8, position + 8 + length);
        const storedCrc = payload.readUInt32BE(position + 8 + length);
        const computedCrc = zlib.crc32(Buffer.concat([chunkType, chunkData])) >>> 0;

        assert.equal(
          storedCrc,
          computedCrc,
          `ICO entry ${index} PNG chunk '${chunkType}' failed its CRC check`
        );

        position += 12 + length;
      }
    }
  });
});

describe("OneVue Phase 5.14 — Template & Version Resolution", () => {
  const {
    validateTemplateRelease,
    resolveTemplateArtifactPath,
    renderPublicTemplateHtml,
    APPROVED_TEMPLATE_REGISTRY,
  } = require("../src/lib/template-renderer.js");

  const originalCwd = process.cwd();

  beforeEach(() => {
    // The renderer's release validation resolves the templates root relative
    // to the process working directory.
    process.chdir(path.resolve(__dirname, ".."));
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  function sampleDto(templateId, templateVersion) {
    return {
      meta: {
        schemaVersion: "1.0.0",
        username: "resolver",
        canonicalUrl: "https://onevue.me/p/resolver",
        publishedAt: "2026-10-30T10:00:00.000Z",
        templateId,
        templateVersion,
      },
      profile: {
        displayName: "Resolver Subject",
        headline: "Systems Engineer",
        bio: "Verifies template release resolution.",
      },
    };
  }

  function sampleWebsite(templateId, templateVersion) {
    return {
      username: "resolver",
      templateId,
      templateVersion,
      publishedAt: "2026-10-30T10:00:00.000Z",
      revisionNumber: 1,
      customization: {
        accentColor: "#3b82f6",
        themeMode: "system",
        visibleSections: ["about"],
      },
    };
  }

  it("resolves the dynamic template release from the backend artifact storage", async () => {
    const { release, resolution } = await resolveTemplateRelease(
      DYNAMIC_TEMPLATE_ID,
      DYNAMIC_TEMPLATE_VERSION
    );

    assert.equal(resolution.ok, true, resolution.error);
    assert.ok(release, "The dynamic release must resolve from backend artifact storage");
    assert.equal(release.transport, "direct", "Local development uses the backend boundary in-process");
    assert.equal(release.templateId, DYNAMIC_TEMPLATE_ID);
    assert.equal(release.templateVersion, DYNAMIC_TEMPLATE_VERSION);
    assert.ok(release.manifest, "A dynamically stored release must expose its validated manifest");

    const entrypoint = path.join(
      DYNAMIC_ARTIFACTS_ROOT,
      DYNAMIC_TEMPLATE_ID,
      DYNAMIC_TEMPLATE_VERSION,
      "index.html"
    );
    assert.ok(fs.existsSync(entrypoint), "Resolved dynamic entrypoint must exist on disk");

    // The release must NOT be served from an independently copied fixture
    // inside the portfolio application.
    assert.ok(
      !entrypoint.startsWith(path.resolve(__dirname, "..") + path.sep),
      "The dynamic template release must not resolve from inside the portfolio application tree"
    );

    // Exact version pinning: an unrequested version is never substituted.
    const other = await resolveTemplateRelease(DYNAMIC_TEMPLATE_ID, "1.0.0");
    assert.equal(other.resolution.ok, false);
    assert.equal(other.resolution.failure, "MISSING_ARTIFACT");
  });

  it("rejects an unapproved dynamic template version", async () => {
    const { release, resolution } = await resolveTemplateRelease(DYNAMIC_TEMPLATE_ID, "9.9.9");
    assert.equal(resolution.ok, false, "An unreleased dynamic version must be rejected");
    assert.equal(release, undefined);
    assert.equal(resolution.failure, "MISSING_ARTIFACT");
  });

  it("resolves the built-in static template through the approved central registry", () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(APPROVED_TEMPLATE_REGISTRY, STATIC_TEMPLATE_ID),
      "The built-in MagicUI template must remain in the approved central registry"
    );
    assert.ok(
      APPROVED_TEMPLATE_REGISTRY[STATIC_TEMPLATE_ID].approvedVersions.includes(STATIC_TEMPLATE_VERSION),
      "The built-in MagicUI template must keep its approved version pinned"
    );

    assert.doesNotThrow(() => {
      validateTemplateRelease(STATIC_TEMPLATE_ID, STATIC_TEMPLATE_VERSION);
    });

    const resolved = resolveTemplateArtifactPath(STATIC_TEMPLATE_ID, STATIC_TEMPLATE_VERSION);
    assert.equal(
      resolved,
      path.join(TEMPLATES_ROOT, STATIC_TEMPLATE_ID, STATIC_TEMPLATE_VERSION, "index.html")
    );
  });

  it("rejects an unapproved built-in static template version", () => {
    assert.throws(
      () => validateTemplateRelease(STATIC_TEMPLATE_ID, "2.0.0"),
      /unapproved or unsupported/,
      "An unapproved built-in version must be rejected"
    );
  });

  it("renders the dynamic template from its own versioned artifact with the DTO injected", async () => {
    const entrypoint = await resolveTemplateEntrypointHtml(
      DYNAMIC_TEMPLATE_ID,
      DYNAMIC_TEMPLATE_VERSION
    );
    assert.equal(entrypoint.resolution.ok, true, entrypoint.resolution.error);
    assert.ok(entrypoint.html, "The backend boundary must deliver the entrypoint document");

    const html = renderPublicTemplateHtml({
      dto: sampleDto(DYNAMIC_TEMPLATE_ID, DYNAMIC_TEMPLATE_VERSION),
      website: sampleWebsite(DYNAMIC_TEMPLATE_ID, DYNAMIC_TEMPLATE_VERSION),
      entrypointHtml: entrypoint.html,
    });

    assert.ok(html.startsWith("<!DOCTYPE html>"), "Must render a full HTML5 document");
    assert.ok(
      html.includes(`<script type="application/json" id="__ONEVUE_DTO__">`),
      "Must inject the DTO script tag"
    );
    assert.equal(
      (html.match(/id=["']__ONEVUE_DTO__["']/g) || []).length,
      1,
      "Exactly one DTO script tag must be present"
    );

    const scriptMatch = html.match(
      /<script\s+type=["']application\/json["']\s+id=["']__ONEVUE_DTO__["']>([\s\S]*?)<\/script>/
    );
    const payload = JSON.parse(scriptMatch[1]);
    assert.equal(payload.dto.meta.templateId, DYNAMIC_TEMPLATE_ID);
    assert.equal(payload.dto.meta.templateVersion, DYNAMIC_TEMPLATE_VERSION);

    // The rendered document must reference its own versioned asset directory.
    assert.ok(
      html.includes(`/templates/${DYNAMIC_TEMPLATE_ID}/${DYNAMIC_TEMPLATE_VERSION}/assets/`),
      "Rendered dynamic template must reference its own versioned assets"
    );
    assert.ok(
      !html.includes(`/templates/${STATIC_TEMPLATE_ID}/${STATIC_TEMPLATE_VERSION}/assets/`),
      "Rendered dynamic template must not reference the built-in template's assets"
    );
  });

  it("keeps the built-in MagicUI template backward compatible", () => {
    const html = renderPublicTemplateHtml({
      dto: sampleDto(STATIC_TEMPLATE_ID, STATIC_TEMPLATE_VERSION),
      website: sampleWebsite(STATIC_TEMPLATE_ID, STATIC_TEMPLATE_VERSION),
      templatesRootDir: TEMPLATES_ROOT,
    });

    assert.ok(html.startsWith("<!DOCTYPE html>"), "Must render a full HTML5 document");
    assert.ok(html.includes('<div id="root"></div>'), "Must contain the React mount root");

    const scriptMatch = html.match(
      /<script\s+type=["']application\/json["']\s+id=["']__ONEVUE_DTO__["']>([\s\S]*?)<\/script>/
    );
    assert.ok(scriptMatch, "Must inject the DTO script tag");
    const payload = JSON.parse(scriptMatch[1]);
    assert.equal(payload.dto.profile.displayName, "Resolver Subject");
    assert.equal(payload.website.templateId, STATIC_TEMPLATE_ID);

    assert.ok(
      html.includes(`/templates/${STATIC_TEMPLATE_ID}/${STATIC_TEMPLATE_VERSION}/assets/`),
      "Rendered built-in template must keep referencing its own versioned assets"
    );
    assert.ok(
      !html.includes(`/templates/${DYNAMIC_TEMPLATE_ID}/${DYNAMIC_TEMPLATE_VERSION}/assets/`),
      "Rendered built-in template must not reference the dynamic template's assets"
    );
  });
});

describe("OneVue Phase 5.14 — Public Route 404 Semantics", () => {
  const routeDir = path.resolve(__dirname, "../src/app/p/[username]");

  it("resolves the published snapshot in a segment layout above the loading boundary", () => {
    const layoutPath = path.join(routeDir, "layout.tsx");
    assert.ok(
      fs.existsSync(layoutPath),
      "The public profile segment must resolve the snapshot in a layout so the not-found status is committed before the shell flushes"
    );

    const layoutSource = fs.readFileSync(layoutPath, "utf8");
    assert.ok(
      layoutSource.includes("notFound()"),
      "The segment layout must call notFound() for unpublished profiles"
    );
    assert.ok(
      layoutSource.includes("getPublishedProfile"),
      "The segment layout must resolve the published profile snapshot"
    );

    // Upstream failures must be raised by the layout, before the response
    // shell is flushed, so that the HTTP 500 status is committed.
    assert.ok(
      /throw\s+new\s+Error/.test(layoutSource),
      "The segment layout must raise upstream failures so the HTTP 500 status is committed before the shell flushes"
    );
  });

  it("provides sibling segment boundaries that render the designed experiences", () => {
    // A segment error boundary does NOT catch errors raised by its own
    // segment's layout, and a not-found boundary does NOT catch notFound()
    // raised by that segment's layout. Both therefore need a sibling
    // boundary in the parent segment (/p) to render the designed UI.
    const parentErrorBoundaryPath = path.resolve(__dirname, "../src/app/p/error.tsx");
    assert.ok(
      fs.existsSync(parentErrorBoundaryPath),
      "The /p segment must provide an error boundary for errors raised by the [username] layout"
    );

    const parentErrorBoundarySource = fs.readFileSync(parentErrorBoundaryPath, "utf8");
    assert.ok(
      parentErrorBoundarySource.includes("Unable to Load Portfolio"),
      "The /p error boundary must render the designed service-unavailable experience"
    );

    const parentNotFoundPath = path.resolve(__dirname, "../src/app/p/not-found.tsx");
    assert.ok(
      fs.existsSync(parentNotFoundPath),
      "The /p segment must provide a not-found boundary for the layout's notFound()"
    );

    const parentNotFoundSource = fs.readFileSync(parentNotFoundPath, "utf8");
    assert.ok(
      parentNotFoundSource.includes("[username]/not-found"),
      "The /p not-found boundary must render the designed portfolio-not-available experience"
    );
  });

  it("raises upstream failures from the route page as a defensive fallback", () => {
    const pageSource = fs.readFileSync(path.join(routeDir, "page.tsx"), "utf8");

    assert.ok(
      /throw\s+new\s+Error/.test(pageSource),
      "The route page must raise non-404 upstream failures"
    );
    assert.ok(
      pageSource.includes("notFound()"),
      "The route page must still call notFound() for unpublished profiles"
    );

    // The segment must provide an error boundary that renders the designed
    // retry experience rather than a raw framework error page.
    const errorBoundaryPath = path.join(routeDir, "error.tsx");
    assert.ok(
      fs.existsSync(errorBoundaryPath),
      "The public profile segment must provide an error boundary"
    );
  });

  it("shares one deduplicated upstream lookup between the layout and the page", () => {
    const routeHelperPath = path.resolve(__dirname, "../src/lib/onevue-profile-route.ts");
    assert.ok(
      fs.existsSync(routeHelperPath),
      "A request-scoped profile lookup helper must exist for the public profile route"
    );

    const helperSource = fs.readFileSync(routeHelperPath, "utf8");
    assert.ok(
      helperSource.includes("cache("),
      "The route profile lookup must be wrapped in React cache() to avoid duplicate upstream requests"
    );

    const pageSource = fs.readFileSync(path.join(routeDir, "page.tsx"), "utf8");
    assert.ok(
      pageSource.includes("getPublishedProfile"),
      "The route page must consume the shared request-scoped profile lookup"
    );
    assert.ok(
      !pageSource.includes("fetchPublishedProfile("),
      "The route page must not issue an independent upstream lookup"
    );
  });

  it("validates the published template release in the layout, before the shell flushes", () => {
    // Phase 5.13 — the release must be resolved and integrity-validated in the
    // SEGMENT LAYOUT. A failure raised only in the page renders the error
    // experience but still returns HTTP 200, because the response shell has
    // already been flushed by then.
    const layoutSource = fs.readFileSync(path.join(routeDir, "layout.tsx"), "utf8");

    assert.ok(
      layoutSource.includes("resolveVisitorTemplateRelease"),
      "The segment layout must resolve the published template release through artifact storage"
    );
    assert.ok(
      /throw\s+new\s+Error/.test(layoutSource),
      "The segment layout must raise release resolution failures so the HTTP 500 status is committed"
    );

    // The release resolution helper must exist and validate the release.
    const releaseHelperPath = path.resolve(
      __dirname,
      "../src/lib/template-visitor-release.ts"
    );
    assert.ok(
      fs.existsSync(releaseHelperPath),
      "A visitor release resolution helper must exist for the public profile route"
    );

    const releaseHelperSource = fs.readFileSync(releaseHelperPath, "utf8");
    assert.ok(
      releaseHelperSource.includes("resolveTemplateRelease"),
      "The visitor release helper must resolve the release through the artifact store"
    );

    // The page must not duplicate the resolution: it would resolve the same
    // release a second time and could diverge from the validated one.
    const pageSource = fs.readFileSync(path.join(routeDir, "page.tsx"), "utf8");
    assert.ok(
      !pageSource.includes("resolveVisitorTemplateRelease"),
      "The route page must not resolve the release again; the layout already validated it"
    );
  });
});
