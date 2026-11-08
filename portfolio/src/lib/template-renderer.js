"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * =========================================================================
 * OneVue Local Public Template Serving Engine (Phase 2.4.4)
 *
 * Guarantees:
 * - Only approved templates and immutable versions from Central Registry.
 * - Strict path traversal rejection and containment enforcement.
 * - Verification that production entrypoint (index.html) exists on disk.
 * - Zero fallback to other templates, hardcoded demo data, or legacy layouts.
 * - Safe DTO serialization escaping '<' as '\u003c' (prevents </script> breakout).
 * - Exact injection into production __ONEVUE_DTO__ script placeholder.
 * - Accurate SEO and head metadata injection.
 * =========================================================================
 */

const TEMPLATE_ID = "magicui-portfolio";
const TEMPLATE_VERSION = "1.0.0";
const SUPPORTED_DTO_SCHEMA_VERSION = "1.0.0";

const APPROVED_TEMPLATE_REGISTRY = Object.freeze({
  [TEMPLATE_ID]: Object.freeze({
    name: "Magic UI Developer Portfolio",
    approvedVersions: Object.freeze([TEMPLATE_VERSION]),
    supportedDtoVersions: Object.freeze([SUPPORTED_DTO_SCHEMA_VERSION]),
    entrypoint: "index.html",
  }),
});

/**
 * =========================================================================
 * Phase 5.14 — Delivery ownership
 * =========================================================================
 *
 * This module does NOT resolve the backend artifact storage root and does NOT
 * validate release manifests. Dynamic template releases are stored, validated
 * and delivered exclusively by the backend artifact delivery boundary
 * (backend/lib/template-artifact-delivery.ts), which the visitor path reaches
 * through src/lib/template-artifact-store.ts.
 *
 * What remains here is genuinely portfolio-owned:
 *  - the built-in template registry (templates that ship with this app),
 *  - the bundled static directory those templates live in,
 *  - DTO serialization and safe HTML injection.
 *
 * The visitor entrypoint is passed in as `entrypointHtml`, already fetched and
 * verified through the delivery boundary, so the document that is rendered is
 * the document the backend stored and validated.
 */

/**
 * Reports whether a template is a built-in, registry-approved template.
 */
function isRegistryTemplate(templateId) {
  return Boolean(APPROVED_TEMPLATE_REGISTRY[templateId]);
}

/**
 * Validates the identity and version of a BUILT-IN template against the
 * central registry. Strictly rejects path traversal, illegal characters and
 * unapproved versions.
 *
 * Dynamic releases are deliberately not resolved here: they have no registry
 * entry and are validated by the backend artifact delivery boundary.
 */
function validateTemplateRelease(templateId, version) {
  if (typeof templateId !== "string" || !templateId.trim()) {
    throw new Error("Template validation error: templateId is required.");
  }
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("Template validation error: templateVersion is required.");
  }

  const cleanId = templateId.trim();
  const cleanVersion = version.trim();

  // Strict path traversal and injection guards
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanId) || cleanId.includes("..")) {
    throw new Error(
      `Path traversal rejected: templateId '${cleanId}' contains illegal characters or path traversal sequences.`
    );
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(cleanVersion) || cleanVersion.includes("..")) {
    throw new Error(
      `Path traversal rejected: version '${cleanVersion}' contains illegal characters or path traversal sequences.`
    );
  }

  const registered = APPROVED_TEMPLATE_REGISTRY[cleanId];
  if (!registered) {
    throw new Error(
      `Template rejection: '${cleanId}' is not an approved template in the OneVue Central Registry.`
    );
  }
  if (!registered.approvedVersions.includes(cleanVersion)) {
    throw new Error(
      `Template release rejection: version '${cleanVersion}' is unapproved or unsupported for template '${cleanId}'.`
    );
  }
}

/**
 * Resolves the absolute directory path where versioned template artifacts are staged.
 *
 * This is the BUILT-IN template root: the templates that ship with the
 * portfolio application itself (e.g. magicui-portfolio). Dynamically stored
 * releases are NEVER resolved from here; they live in the backend artifact
 * storage and are resolved by resolveTemplateArtifactsRoot().
 */
function resolveTemplatesRootDir(customDir) {
  if (customDir && typeof customDir === "string" && customDir.trim()) {
    return path.resolve(customDir.trim());
  }

  const cwd = process.cwd();
  const candidates = [
    process.env.ONEVUE_TEMPLATES_ROOT_DIR,
    path.resolve(cwd, "public", "templates"),
    path.resolve(cwd, "portfolio", "public", "templates"),
    path.resolve(__dirname, "../../public/templates"),
    path.resolve(__dirname, "../../../portfolio/public/templates"),
  ].filter(Boolean);

  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) {
        return cand;
      }
    } catch {
      // Continue searching
    }
  }

  return path.resolve(cwd, "public", "templates");
}

/**
 * Resolves the entrypoint artifact path on disk for a BUILT-IN template and
 * verifies its existence. Guarantees zero fallback to other templates.
 *
 * Dynamic releases have no bundled entrypoint: their document is delivered by
 * the backend artifact delivery boundary and supplied to renderPublicTemplateHtml.
 */
function resolveTemplateArtifactPath(templateId, version, customRootDir) {
  validateTemplateRelease(templateId, version);

  const cleanId = templateId.trim();
  const cleanVersion = version.trim();
  const rootDir = resolveTemplatesRootDir(customRootDir);

  const candidatePath = path.resolve(rootDir, cleanId, cleanVersion, "index.html");

  // Secondary traversal barrier: canonical path must stay within rootDir
  const canonicalRoot = path.resolve(rootDir);
  if (!candidatePath.startsWith(canonicalRoot + path.sep)) {
    throw new Error(
      `Security violation: resolved artifact path escapes template storage boundary: '${candidatePath}'.`
    );
  }

  if (!fs.existsSync(candidatePath)) {
    throw new Error(
      `Template artifact not found: missing entrypoint 'index.html' for release '${cleanId}@${cleanVersion}'. Local template serving cannot proceed without the required production build artifact.`
    );
  }

  return candidatePath;
}

/**
 * Safely serializes the public profile DTO and website metadata.
 * Strictly escapes '<' as '\\u003c' so '</script>' or other HTML tags
 * cannot terminate or break out of the non-executable application/json script block.
 */
function serializeDtoPayload(payload) {
  if (!payload || !payload.dto) {
    throw new Error("Cannot serialize DTO: missing payload root or dto object.");
  }

  const rawJson = JSON.stringify(payload);

  return rawJson
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Escapes characters for safe inclusion in HTML attribute or title values.
 */
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Injects the safely serialized DTO payload into the standalone template's
 * index.html placeholder without creating duplicate script tags.
 * Preserves SEO metadata where feasible.
 */
function injectDtoIntoHtml(rawHtml, safeJsonPayload, seo) {
  if (typeof rawHtml !== "string" || !rawHtml.trim()) {
    throw new Error("Template injection error: raw HTML content is empty.");
  }

  const scriptTag = `<script type="application/json" id="__ONEVUE_DTO__">${safeJsonPayload}</script>`;

  let html = rawHtml;

  // Placeholder comment in production artifact:
  // <!-- <script type="application/json" id="__ONEVUE_DTO__">{}</script> -->
  const placeholderCommentRegex =
    /<!--\s*<script\s+type=["']application\/json["']\s+id=["']__ONEVUE_DTO__["']>[\s\S]*?<\/script>\s*-->/i;

  // Existing active script tag with the same ID:
  const activeScriptRegex =
    /<script\s+type=["']application\/json["']\s+id=["']__ONEVUE_DTO__["']>[\s\S]*?<\/script>/i;

  if (placeholderCommentRegex.test(html)) {
    html = html.replace(placeholderCommentRegex, scriptTag);
  } else if (activeScriptRegex.test(html)) {
    html = html.replace(activeScriptRegex, scriptTag);
  } else if (html.includes("</head>")) {
    html = html.replace("</head>", `  ${scriptTag}\n  </head>`);
  } else {
    html = `${scriptTag}\n${html}`;
  }

  // Strictly verify no duplicate script tags with id="__ONEVUE_DTO__"
  const occurrences = (html.match(/id=["']__ONEVUE_DTO__["']/g) || []).length;
  if (occurrences > 1) {
    throw new Error(
      `Template injection integrity error: multiple __ONEVUE_DTO__ script tags found (${occurrences}). Exactly one script tag is permitted.`
    );
  }

  // Update SEO metadata in HTML head where feasible
  if (seo) {
    if (seo.title) {
      const safeTitle = escapeHtml(seo.title);
      if (/<title>[\s\S]*?<\/title>/i.test(html)) {
        html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);
      }
    }
    if (seo.description) {
      const safeDesc = escapeHtml(seo.description);
      if (/<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?>/i.test(html)) {
        html = html.replace(
          /<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?>/i,
          `<meta name="description" content="${safeDesc}" />`
        );
      } else if (html.includes("</head>")) {
        html = html.replace("</head>", `  <meta name="description" content="${safeDesc}" />\n  </head>`);
      }
    }
    if (seo.canonicalUrl) {
      const safeCanonical = escapeHtml(seo.canonicalUrl);
      if (/<link\s+rel=["']canonical["'][^>]*\/?>/i.test(html)) {
        html = html.replace(
          /<link\s+rel=["']canonical["'][^>]*\/?>/i,
          `<link rel="canonical" href="${safeCanonical}" />`
        );
      } else if (html.includes("</head>")) {
        html = html.replace("</head>", `  <link rel="canonical" href="${safeCanonical}" />\n  </head>`);
      }
    }

    // Adapted templates drop the author's own og:* values, so the student's
    // share metadata has to be supplied here or the page advertises nobody.
    if (seo.title || seo.description || seo.canonicalUrl) {
      const ogTags = [
        seo.title ? `<meta property="og:title" content="${escapeHtml(seo.title)}" />` : "",
        seo.description ? `<meta property="og:description" content="${escapeHtml(seo.description)}" />` : "",
        seo.canonicalUrl ? `<meta property="og:url" content="${escapeHtml(seo.canonicalUrl)}" />` : "",
        seo.profilePhoto ? `<meta property="og:image" content="${escapeHtml(seo.profilePhoto)}" />` : "",
        `<meta property="og:type" content="website" />`,
      ]
        .filter(Boolean)
        .join("\n  ");
      if (/<meta\s+property=["']og:title["'][^>]*\/?>/i.test(html)) {
        html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*\/?>\s*/gi, "");
      }
      if (html.includes("</head>")) {
        html = html.replace("</head>", `  ${ogTags}\n  </head>`);
      }
    }
  }

  return html;
}

/**
 * Public high-level rendering entrypoint.
 * Consumes the validated public DTO snapshot and website metadata,
 * validates against registry, reads entrypoint artifact, safely serializes,
 * and returns the injected HTML document ready to serve.
 */
function renderPublicTemplateHtml(options) {
  if (!options) {
    throw new Error("renderPublicTemplateHtml options are required.");
  }
  const { dto, website, templatesRootDir, entrypointHtml } = options;

  if (!dto || !dto.meta || !dto.profile) {
    throw new Error("Invalid OneVue profile payload: missing root metadata or profile.");
  }
  if (!website || typeof website.username !== "string") {
    throw new Error("Invalid website metadata: missing username.");
  }

  const templateId = (website.templateId || TEMPLATE_ID).trim();
  const templateVersion = (website.templateVersion || TEMPLATE_VERSION).trim();

  // The document to render. For a dynamically stored release it was already
  // delivered and integrity-verified by the backend artifact delivery boundary,
  // so it is never re-read from a local copy here.
  let rawHtml;
  if (typeof entrypointHtml === "string" && entrypointHtml.trim()) {
    rawHtml = entrypointHtml;
  } else {
    // Bundled (built-in) releases only. A dynamic release has no bundled
    // entrypoint and must be delivered through the backend boundary.
    validateTemplateRelease(templateId, templateVersion);
    if (!isRegistryTemplate(templateId)) {
      throw new Error(
        `Template rejection: '${templateId}@${templateVersion}' is not a built-in template. Dynamically stored releases are delivered through the backend artifact delivery boundary.`
      );
    }
    rawHtml = fs.readFileSync(
      resolveTemplateArtifactPath(templateId, templateVersion, templatesRootDir),
      "utf8"
    );
  }

  // 4. Safely serialize payload
  const safeJsonPayload = serializeDtoPayload({ dto, website });

  // 5. Compute SEO metadata
  const displayName = dto.profile.displayName || website.username || "Student";
  const headline = dto.profile.headline || `${displayName}'s personal portfolio`;
  const canonicalUrl = dto.meta.canonicalUrl || `https://onevue.me/p/${website.username}`;

  // 6. Inject payload into placeholder
  return injectDtoIntoHtml(rawHtml, safeJsonPayload, {
    title: `${displayName} | Portfolio`,
    description: headline,
    canonicalUrl,
    profilePhoto: dto.profile.profilePhoto,
  });
}

module.exports = {
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  SUPPORTED_DTO_SCHEMA_VERSION,
  APPROVED_TEMPLATE_REGISTRY,
  validateTemplateRelease,
  resolveTemplatesRootDir,
  isRegistryTemplate,
  resolveTemplateArtifactPath,
  serializeDtoPayload,
  injectDtoIntoHtml,
  renderPublicTemplateHtml,
};
