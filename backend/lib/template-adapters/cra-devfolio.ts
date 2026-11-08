/**
 * =========================================================================
 * OneVue CRA adaptation strategy (`create-react-app` / devfolio content shape)
 * =========================================================================
 *
 * Create React App templates in the developerFolio family ship a production
 * build that cannot be delivered by OneVue as-is. This module turns each of
 * those defects into a reusable, source-level adaptation so that ANY CRA
 * template of this shape becomes deliverable through the artifact boundary:
 *
 *   1. Absolute `/static/...` asset URLs (404 under a versioned release path)
 *      -> `homepage` becomes the release asset base path, which CRA folds into
 *         webpack's publicPath and into the emitted HTML.
 *   2. `BrowserRouter` cannot route inside an `iframe srcdoc` visitor document
 *      -> normalized to `MemoryRouter` with the visitor's deep-link route.
 *   3. Personal content is a static JS module -> regenerated from the injected
 *         `__ONEVUE_DTO__` payload, self-contained so the author's content
 *         module is not shipped at all.
 *   4. Original-author analytics/ads and unused CDN tags -> removed.
 *   5. Production source maps -> disabled through CRA's own `.env`.
 *   6. PWA manifest + service worker that nothing registers -> removed.
 *   7. Malformed, duplicated and author-identifying head metadata -> repaired.
 *
 * Every transform is a pure text transform of the source tree. Nothing here
 * executes template code: the adaptation runs on the host, and untrusted
 * source must never be evaluated there.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  GENERATED_MARKER,
  RUNTIME_MODULE_PATH,
  normalizeBrowserRouter,
  runtimeModuleSource,
} from "./react-vite";

export type CraFindingSeverity = "info" | "warning" | "error";

export interface CraFinding {
  code: string;
  severity: CraFindingSeverity;
  message: string;
  file?: string;
}

export interface CraAdapterInput {
  adaptedDir: string;
  templateId: string;
  templateVersion: string;
  pkg: any;
}

export interface CraAdapterOutcome {
  ok: boolean;
  status: "ADAPTED" | "INCOMPATIBLE" | "FAILED";
  findings: CraFinding[];
  createdFiles: Array<{ relativePath: string; purpose: string }>;
  modifiedFiles: Array<{ relativePath: string; purpose: string }>;
  buildScript?: string;
  /** Which portfolio sections the generated content module really feeds from the DTO. */
  sections?: { mapped: string[]; unmapped: string[] };
  error?: string;
}

/**
 * The section vocabulary OneVue uses when describing a template's supported
 * schema, and the content-module export each one depends on. `mapped` is
 * derived from what the generated module actually reads from the DTO, so the
 * catalog can never claim a section the template does not render from student
 * data.
 */
export const DEVFOLIO_SECTION_MAP: Array<{ section: string; exportName: string; dtoBacked: boolean }> = [
  { section: "hero", exportName: "greeting", dtoBacked: true },
  { section: "about", exportName: "seo", dtoBacked: true },
  { section: "education", exportName: "degrees", dtoBacked: true },
  { section: "skills", exportName: "skills", dtoBacked: true },
  { section: "projects", exportName: "projects.generated", dtoBacked: true },
  { section: "credentials", exportName: "certifications", dtoBacked: true },
  { section: "contact", exportName: "contactPageData", dtoBacked: true },
  // PublicProfileDTO_v1 has no employment history, no hackathons and no media
  // gallery, so the devfolio template cannot render them from student data.
  { section: "work", exportName: "experience", dtoBacked: false },
  { section: "hackathons", exportName: "", dtoBacked: false },
  { section: "achievements", exportName: "", dtoBacked: false },
  { section: "media", exportName: "", dtoBacked: false },
];

export function deriveSupportedSections(): { mapped: string[]; unmapped: string[] } {
  return {
    mapped: DEVFOLIO_SECTION_MAP.filter((entry) => entry.dtoBacked).map((entry) => entry.section),
    unmapped: DEVFOLIO_SECTION_MAP.filter((entry) => !entry.dtoBacked).map((entry) => entry.section),
  };
}

export interface CraDetection {
  detected: boolean;
  contentModule?: string;
  evidence: string[];
  reasons: string[];
}

export interface ContentAssets {
  isSplash: boolean;
  projectsAvatar: string;
  contactAvatar: string;
  blogAvatar: string;
  experienceHeader: string;
  experienceSubtitle: string;
  skillImages: string[];
  degreeLogos: Array<[string, string]>;
  certificationLogos: Array<[string, string]>;
}

/** Hosts that exist only to observe the visitor. Never a template feature. */
const TRACKING_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "doubleclick.net",
  "googleadservices.com",
  "googlesyndication.com",
  "analytics.google.com",
  "facebook.com/tr",
  "connect.facebook.net",
];

/**
 * CDN libraries are only kept when the template actually references the global
 * they define. `font-awesome` is special-cased because CRA templates import
 * the full stylesheet from `src/assets`, making the CDN link redundant.
 */
const CDN_GLOBALS: Array<{ match: RegExp; global: RegExp; redundantWhen?: string }> = [
  { match: /font-?awesome/i, global: /font-?awesome/i, redundantWhen: "font-awesome" },
  { match: /anime(?:js)?[.-]/i, global: /\banime\s*\(/ },
  { match: /canvasjs/i, global: /CanvasJS/ },
  { match: /iconify/i, global: /\biconify\b/ },
];

const CRA_ARTIFACT_DIR = "build";

/** Metadata keys that describe the page rather than a person. */
const VALID_META_NAMES = new Set([
  "viewport", "description", "keywords", "author", "application-name", "theme-color",
  "msapplication-TileColor", "msapplication-TileImage", "msapplication-config", "robots",
  "generator", "format-detection",
]);

/**
 * Head metadata whose value is the original author's identity. The visitor
 * renderer supplies student-owned SEO metadata, so shipping the author's
 * values would publish someone else's name on a student's page.
 */
const AUTHOR_METADATA_PATTERNS: RegExp[] = [
  /<meta\b[^>]*\bproperty\s*=\s*["']og:(?:title|description|url|image|type)["'][^>]*\/?>/gi,
  /<meta\b[^>]*\bitemprop\s*=\s*["'](?:name|description|image|url)["'][^>]*\/?>/gi,
  /<meta\b[^>]*\bname\s*=\s*["'](?:keywords|author|application-name)["'][^>]*\/?>/gi,
  /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\/?>/gi,
];

/** The single asset base path contract shared with the delivery boundary. */
export function releaseAssetBasePath(templateId: string, templateVersion: string): string {
  return `/templates/${templateId}/${templateVersion}/`;
}

export function detectCraDevfolio(sourceDir: string, pkg: any): CraDetection {
  const evidence: string[] = [];
  const reasons: string[] = [];

  const hasReactScripts = Boolean(
    pkg?.dependencies?.["react-scripts"] ||
      pkg?.devDependencies?.["react-scripts"] ||
      /\breact-scripts\b/.test(String(pkg?.scripts?.build || ""))
  );
  if (hasReactScripts) evidence.push("react-scripts is the build tool");
  else reasons.push("No react-scripts dependency or build script was found.");

  const contentModule = findDevfolioContentModule(sourceDir);
  if (contentModule) evidence.push(`content module '${contentModule}' exports greeting + socialMediaLinks`);
  else reasons.push("No src/ module exporting both `greeting` and `socialMediaLinks` was found.");

  return {
    detected: hasReactScripts && Boolean(contentModule),
    contentModule,
    evidence,
    reasons,
  };
}

/**
 * The devfolio signature is a `src/` module that exports the personal content
 * surface. Detection, not assumption, keeps this strategy reusable for the
 * whole template family.
 */
export function findDevfolioContentModule(sourceDir: string): string | undefined {
  const srcDir = path.join(sourceDir, "src");
  if (!fs.existsSync(srcDir)) return undefined;

  const candidates: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "onevue") continue;
        visit(full);
      } else if (/\.jsx?$/.test(entry.name)) {
        candidates.push(full);
      }
    }
  };
  visit(srcDir);

  for (const file of candidates) {
    let source = "";
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const names = readExportedNames(source);
    if (names.includes("greeting") && names.includes("socialMediaLinks")) {
      return path.relative(sourceDir, file).replace(/\\/g, "/");
    }
  }
  return undefined;
}

/** `export { a, b }` and `export const x` names, in declaration order. */
export function readExportedNames(source: string): string[] {
  const names = new Set<string>();
  const block = source.match(/export\s*\{([^}]*)\}/g) || [];
  for (const entry of block) {
    const inner = entry.replace(/export\s*\{/, "").replace(/\}$/, "");
    for (const part of inner.split(",")) {
      const token = part.trim();
      if (!token || token.startsWith("//") || token.startsWith("/*")) continue;
      const asMatch = token.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      const name = asMatch ? asMatch[2] : token.match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (name) names.add(name);
    }
  }
  for (const match of source.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * Extracts only the asset *file names* the template's own components resolve
 * through `require(\`../../assets/images/${name}\`)`. Those names are structural
 * and must survive; the personal values next to them must not.
 */
export function extractContentAssets(source: string): ContentAssets {
  const quoted = (regex: RegExp): string | undefined => source.match(regex)?.[1];

  /**
   * Brace matching, not a line-based regex: the same content module is written
   * one-property-per-line in some templates and minified onto one line in
   * others, and both must adapt identically.
   */
  const sectionOf = (name: string): string => {
    const start = source.search(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*\\{`));
    if (start === -1) return "";
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(open, index + 1);
      }
    }
    return "";
  };

  const logoPairs = (sectionName: string): Array<[string, string]> => {
    const section = sectionOf(sectionName);
    const pairs: Array<[string, string]> = [];
    for (const match of section.matchAll(/\{[^{}]*\}/g)) {
      const entry = match[0];
      const title = entry.match(/\btitle:\s*"([^"]*)"/)?.[1];
      const logo = entry.match(/\blogo_path:\s*"([^"]*)"/)?.[1];
      if (title && logo) pairs.push([title.toLowerCase(), logo]);
    }
    return pairs;
  };

  const experienceSection = sectionOf("experience");

  return {
    isSplash: /isSplash:\s*true/.test(source),
    projectsAvatar: quoted(/projectsHeader[\s\S]{0,400}?avatar_image_path:\s*"([^"]*)"/) || "projects_image.svg",
    contactAvatar:
      quoted(/contactSection:\s*\{[\s\S]{0,400}?profile_image_path:\s*"([^"]*)"/) || "avatar.svg",
    blogAvatar:
      quoted(/blogSection:\s*\{[\s\S]{0,400}?avatar_image_path:\s*"([^"]*)"/) || "blogs_image.svg",
    experienceHeader:
      experienceSection.match(/header_image_path:\s*"([^"]*)"/)?.[1] || "experience.svg",
    experienceSubtitle:
      experienceSection.match(/subtitle:\s*"([^"]*)"/)?.[1] || "Work, Internship and Volunteership",
    skillImages: [...new Set([...source.matchAll(/fileName:\s*"([^"]*)"/g)].map((m) => m[1]))],
    degreeLogos: logoPairs("degrees"),
    certificationLogos: logoPairs("certifications"),
  };
}

/* =========================================================================
   HTML transforms
   ========================================================================= */

function scriptTags(html: string): Array<{ full: string; src: string; body: string }> {
  const out: Array<{ full: string; src: string; body: string }> = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1] || "";
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    out.push({ full: match[0], src, body: match[2] || "" });
  }
  return out;
}

export function stripThirdPartyTracking(html: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  let output = html;
  for (const tag of scriptTags(output)) {
    const isTrackingSrc = tag.src && TRACKING_HOSTS.some((host) => tag.src.includes(host));
    const isTrackingInline =
      !tag.src && /(\bdataLayer\b|\bgtag\s*\(|\bGoogleAnalyticsObject\b)/.test(tag.body);
    if (isTrackingSrc || isTrackingInline) {
      output = output.split(tag.full).join("");
      removed.push(tag.src || "inline gtag/dataLayer bootstrap");
    }
  }
  return { html: output, removed };
}

export interface CdnTagReview {
  url: string;
  decision: "remove-tracking" | "remove-redundant" | "remove-unused" | "keep-required" | "keep-unreviewed";
  reason: string;
}

/**
 * Reviews every external tag. A library the source never references is dead
 * weight that still costs a third-party request; one it does reference is a
 * functional dependency and is kept and reported rather than silently broken.
 */
export function reviewExternalTags(html: string, sourceText: string): CdnTagReview[] {
  const reviews: CdnTagReview[] = [];
  const externalTags = [
    ...scriptTags(html).filter((t) => /^https?:\/\//i.test(t.src)).map((t) => t.src),
    ...[...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]),
  ];

  for (const url of externalTags) {
    if (TRACKING_HOSTS.some((host) => url.includes(host))) {
      reviews.push({ url, decision: "remove-tracking", reason: "Advertising or analytics host." });
      continue;
    }
    const entry = CDN_GLOBALS.find((candidate) => candidate.match.test(url));
    if (!entry) {
      reviews.push({ url, decision: "keep-unreviewed", reason: "No known usage signature; kept to avoid breaking the template." });
      continue;
    }
    const redundant =
      entry.redundantWhen && new RegExp(`assets/${entry.redundantWhen}`, "i").test(sourceText);
    if (redundant) {
      reviews.push({ url, decision: "remove-redundant", reason: `'${entry.redundantWhen}' is already bundled from src/assets.` });
      continue;
    }
    if (entry.global.test(sourceText)) {
      reviews.push({ url, decision: "keep-required", reason: `The source references ${entry.global}.` });
    } else {
      reviews.push({ url, decision: "remove-unused", reason: `The source never references ${entry.global}.` });
    }
  }
  return reviews;
}

export function stripExternalTags(html: string, urls: string[]): string {
  let output = html;
  for (const url of urls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(
      new RegExp(`<script\\b[^>]*\\bsrc\\s*=\\s*["']${escaped}["'][^>]*>[\\s\\S]*?<\\/script>`, "gi"),
      ""
    );
    output = output.replace(
      new RegExp(`<link\\b[^>]*\\bhref\\s*=\\s*["']${escaped}["'][^>]*?\\/?>`, "gi"),
      ""
    );
  }
  return output;
}

/**
 * Root-absolute URLs in the template's own head (`/icons/favicon.ico`) resolve
 * against the origin, not the release, so they must carry the base path.
 * Duplicate slashes are collapsed: the delivery boundary rejects any asset
 * path with an empty segment, so `/icons//x.png` would be refused outright.
 */
export function prefixRootAbsoluteUrls(html: string, basePath: string): { html: string; rewritten: string[] } {
  const rewritten: string[] = [];
  const base = basePath.replace(/\/+$/, "");
  const output = html.replace(
    /\b(href|src|content)\s*=\s*(["'])(\/[^"'<>]+)\2/gi,
    (full, attr: string, quote: string, value: string) => {
      const normalized = `/${value.replace(/\/{2,}/g, "/").replace(/^\/+/, "")}`;
      if (normalized.startsWith(base + "/")) return full;
      if (attr.toLowerCase() === "content" && !/^\/[A-Za-z0-9._-]/.test(normalized)) return full;
      rewritten.push(normalized);
      return `${attr}=${quote}${base}${normalized}${quote}`;
    }
  );
  return { html: output, rewritten };
}

/**
 * Repairs the metadata defects CRA devfolio templates ship: a `<meta>` whose
 * `name` is a display title rather than a metadata key, duplicated
 * `<link rel="manifest">` entries, and the author's own identity values.
 */
export function repairHeadMetadata(html: string): { html: string; fixes: string[] } {
  const fixes: string[] = [];
  let output = html;

  const invalidMeta = /<meta\b[^>]*\/?>/g;
  for (const tag of output.match(invalidMeta) || []) {
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const hasKnownKey = /\b(?:charset|property|itemprop|http-equiv)\s*=/.test(tag);
    if (name && VALID_META_NAMES.has(name) && !name.includes(" ")) continue;
    if (!name && hasKnownKey) continue;
    if (!name && !/\bname\s*=/.test(tag)) continue;
    output = output.split(tag).join("");
    fixes.push(name ? `removed <meta name="${name}"> (not a metadata key)` : "removed an unkeyed <meta>");
  }

  let removedAuthor = 0;
  for (const pattern of AUTHOR_METADATA_PATTERNS) {
    const matches = output.match(pattern) || [];
    if (matches.length === 0) continue;
    output = output.replace(pattern, "");
    removedAuthor += matches.length;
  }
  if (removedAuthor > 0) {
    fixes.push(`removed ${removedAuthor} author-identifying metadata tag(s) owned by the visitor renderer`);
  }

  const manifestLinks = [...output.matchAll(/<link\b[^>]*\brel\s*=\s*["']manifest["'][^>]*\/?>/gi)];
  if (manifestLinks.length > 1) {
    output = output.replace(/<link\b[^>]*\brel\s*=\s*["']manifest["'][^>]*\/?>/gi, "");
    fixes.push(`de-duplicated ${manifestLinks.length} <link rel="manifest"> entries`);
  }

  // The document title is the author's until the visitor renderer knows the
  // student's, so an empty element is kept as the insertion point.
  const titleMatch = output.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) {
    output = output.replace(/<title>[\s\S]*?<\/title>/i, "<title></title>");
    fixes.push("emptied the static <title>, which the visitor renderer fills from the student profile");
  }

  return { html: output, fixes };
}

/**
 * An HTML comment cannot be used as the placeholder: CRA's minifier strips
 * comments from the production document, so the injection point would vanish.
 * A JSON script block survives and is replaced by the renderer.
 */
export const DTO_SCRIPT_PLACEHOLDER = '<script type="application/json" id="__ONEVUE_DTO__">{}</script>';

export function injectDtoPlaceholder(html: string): { html: string; changed: boolean } {
  if (html.includes("__ONEVUE_DTO__")) return { html, changed: false };
  if (html.includes("</head>")) return { html: html.replace("</head>", `  ${DTO_SCRIPT_PLACEHOLDER}\n  </head>`), changed: true };
  return { html: `${DTO_SCRIPT_PLACEHOLDER}\n${html}`, changed: true };
}

/* =========================================================================
   Content access hardening
   ========================================================================= */

/**
 * Devfolio templates read the author's data as if it always exists:
 * `experience.sections[0].experiences[0].title` and a `mailto:` entry found by
 * `.find(...)` are both dereferenced unchecked. With a real student profile
 * those values are legitimately absent, and one TypeError unmounts the whole
 * application. Each rewrite keeps the original expression's meaning when the
 * data is present and yields `undefined` / `""` when it is not.
 */
export function hardenContentAccess(source: string): {
  changed: boolean;
  source: string;
  fixes: string[];
} {
  const fixes: string[] = [];
  let output = source;

  const sectionsRegex = /\b([A-Za-z_$][\w$]*)\.sections\[0\]\.experiences\[0\]\.([A-Za-z_$][\w$]*)/g;
  if (sectionsRegex.test(output)) {
    output = output.replace(
      /\b([A-Za-z_$][\w$]*)\.sections\[0\]\.experiences\[0\]\.([A-Za-z_$][\w$]*)/g,
      (_full, obj: string, prop: string) =>
        `((((${obj}.sections || [])[0] || {}).experiences || [])[0] || {}).${prop}`
    );
    fixes.push("guarded first-experience access");
  }

  const mailRegex = /let\s+mail\s*=\s*([\s\S]{0,400}?)\.find\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*\.link\.substring\(([^)]*)\)/;
  const mailMatch = output.match(mailRegex);
  if (mailMatch) {
    output = output.replace(
      mailRegex,
      (_full, collection: string, predicate: string, offset: string) =>
        `let mail = (((${collection}.find(${predicate}) || {}).link) || "").substring(${offset})`
    );
    fixes.push("guarded mailto lookup that returns no entry");
  }

  return { changed: output !== source, source: output, fixes };
}

/* =========================================================================
   Content module generation
   ========================================================================= */

export const PROJECTS_MODULE_PATH = "src/onevue/projects.generated.js";

/** Author contribution history: no DTO field can represent it. */
export const CONTRIBUTION_MODULES: string[] = ["issues", "pull_requests", "organizations"];

export function generateEmptyContributionModule(kind: string): string {
  return `/* ${GENERATED_MARKER} ${kind} list — do not edit; regenerated by OneVue adaptation.
   PublicProfileDTO_v1 has no open-source contribution history, so the original
   author's pulls, issues and organizations are not shipped as student data. */
export default { data: [] };
`;
}

export function generateContentModuleSource(
  names: string[],
  assets: ContentAssets,
  imageNames: string[] = []
): string {
  const known = new Set([
    "settings", "seo", "greeting", "socialMediaLinks", "skills", "degrees",
    "certifications", "experience", "projectsHeader", "contactPageData",
  ]);
  const unmapped = names.filter((name) => !known.has(name));
  const needsBase = unmapped.length > 0;

  const lines: string[] = [
    `/* ${GENERATED_MARKER} devfolio content map — regenerated by OneVue adaptation, do not edit. */`,
    `import { getOneVueProfile, getOneVuePayload } from "./onevue/runtime.js";`,
  ];
  if (needsBase) {
    lines.push(`import * as oneVueBase from "./onevue/portfolio.base.js";`);
  }
  lines.push(
    ``,
    `const dto = getOneVueProfile();`,
    `const website = (getOneVuePayload() || {}).website || {};`,
    `const list = (value) => (Array.isArray(value) ? value : []);`,
    `const text = (value, fallback) =>`,
    `  typeof value === "string" && value.trim() ? value : fallback === undefined ? "" : fallback;`,
    `const profile = dto.profile || {};`,
    `const contact = dto.contact || {};`,
    `const socialLinks = list(contact.socialLinks);`,
    `const githubUrl = (socialLinks.find((entry) => /github\\.com/i.test(entry.url || "")) || {}).url || "";`,
    ``,
    `/* Asset file names come from the template; they are structural, not personal.`,
    `   A logo must resolve through require(\`../../assets/images/\${path}\`), which throws`,
    `   for an unknown name, so a DTO item only reuses a logo the template already ships. */`,
    `const ASSETS = ${JSON.stringify(assets, null, 2).replace(/\n/g, "\n")};`,
    ``,
    `function matchLogo(pairs, itemName) {`,
    `  const needle = String(itemName || "").toLowerCase();`,
    `  if (!needle) return "";`,
    `  const hit = pairs.find(([existing]) => existing.includes(needle) || needle.includes(existing[0]))`,
    `    || pairs.find(([existing]) => existing.includes(needle.split(" ")[0]));`,
    `  return hit ? hit[1] : "";`,
    `}`,
    ``,
    `/* Components resolve a logo with require(\`../../assets/images/\${name}\`), which throws`,
    `   for any name the template does not actually ship — including the empty string.`,
    `   Every logo below is therefore chosen from the shipped set or not rendered at all. */`,
    `const IMAGE_SET = ${JSON.stringify(imageNames)};`,
    `const SAFE_FALLBACKS = ["education.svg", "experience.svg", "avatar.svg", "programmer.svg"].filter(`
    +
    `  (name) => IMAGE_SET.indexOf(name) !== -1`,
    `);`,
    `function pickLogo(pairs, itemName) {`,
    `  const direct = matchLogo(pairs, itemName);`,
    `  if (direct && IMAGE_SET.indexOf(direct) !== -1) return direct;`,
    `  const fromPairs = pairs.map((pair) => pair[1]).find((name) => IMAGE_SET.indexOf(name) !== -1);`,
    `  if (fromPairs) return fromPairs;`,
    `  return SAFE_FALLBACKS[0] || "";`,
    `}`,
    `const HAS_ANY_SHIPPED_IMAGE = IMAGE_SET.length > 0;`,
    ``,
    `const SOCIAL_PRESETS = {`,
    `  github: { fontAwesomeIcon: "fa-github", backgroundColor: "#181717" },`,
    `  gitlab: { fontAwesomeIcon: "fa-gitlab", backgroundColor: "#6e49c9" },`,
    `  linkedin: { fontAwesomeIcon: "fa-linkedin-in", backgroundColor: "#0077B5" },`,
    `  twitter: { fontAwesomeIcon: "fa-twitter", backgroundColor: "#1DA1F2" },`,
    `  x: { fontAwesomeIcon: "fa-twitter", backgroundColor: "#000000" },`,
    `  instagram: { fontAwesomeIcon: "fa-instagram", backgroundColor: "#E4405F" },`,
    `  youtube: { fontAwesomeIcon: "fa-youtube", backgroundColor: "#FF0000" },`,
    `  facebook: { fontAwesomeIcon: "fa-facebook-f", backgroundColor: "#3b5998" },`,
    `  medium: { fontAwesomeIcon: "fa-medium-m", backgroundColor: "#000000" },`,
    `  stackoverflow: { fontAwesomeIcon: "fa-stack-overflow", backgroundColor: "#FE7A16" },`,
    `  devdev: { fontAwesomeIcon: "fa-dev", backgroundColor: "#E76C51" },`,
    `  kaggle: { fontAwesomeIcon: "fa-kaggle", backgroundColor: "#20BEFF" },`,
    `  leetcode: { fontAwesomeIcon: "fa-code", backgroundColor: "#FFA116" },`,
    `  email: { fontAwesomeIcon: "fas fa-envelope", backgroundColor: "#bd20e4ff" },`,
    `  website: { fontAwesomeIcon: "fas fa-globe", backgroundColor: "#28a745" },`,
    `  portfolio: { fontAwesomeIcon: "fas fa-globe", backgroundColor: "#28a745" },`,
    `};`,
    ``,
    `const SKILL_COLORS = ["#3e33a3ff", "#00060fff", "#be4444ff", "#f06f38ff", "#26a69aff"];`,
    `const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");`,
    `const duration = (start, end) => {`,
    `  const from = text(start, "").slice(0, 7);`,
    `  const to = text(end, "").slice(0, 7);`,
    `  if (from && to) return \`\${from} - \${to}\`;`,
    `  return from || to;`,
    `};`,
    ``,
    `export const greeting = {`,
    `  title: text(profile.displayName, "Student"),`,
    `  logo_name: text(profile.preferredName, text(profile.initials, "OV")),`,
    `  nickname: text(profile.preferredName, text(profile.initials, "OV")),`,
    `  subTitle: text(profile.headline, text(profile.bio, "")),`,
    `  resumeLink: text((dto.resume || {}).url, ""),`,
    `  portfolio_repository: githubUrl,`,
    `  githubProfile: githubUrl,`,
    `};`,
    ``,
    `export const seo = {`,
    `  title: \`\${text(profile.displayName, "Student")}'s Portfolio\`,`
    ,
    `  description: text(profile.bio, text(profile.headline, "")),`,
    `  og: {`,
    `    title: \`\${text(profile.displayName, "Student")} Portfolio\`,`
    ,
    `    type: "website",`,
    `    url: text(dto.meta && dto.meta.canonicalUrl, text(website.canonicalUrl, "")),`,
    `  },`,
    `};`,
    ``,
    `export const settings = { isSplash: ${assets.isSplash ? "true" : "false"} };`,
    ``,
    `export const socialMediaLinks = [`,
    `  ...(contact.email ? [{ name: "Email", link: \`mailto:\${contact.email}\`, ...SOCIAL_PRESETS.email }] : []),`,
    `  ...socialLinks.map((entry) => {`,
    `    const preset = SOCIAL_PRESETS[slug(entry.platform)] || {`,
    `      fontAwesomeIcon: "fas fa-link",`,
    `      backgroundColor: "#333333",`,
    `    };`,
    `    return {`,
    `      name: text(entry.platform, "Link").replace(/^./, (c) => c.toUpperCase()),`,
    `      link: text(entry.url, ""),`,
    `      fontAwesomeIcon: preset.fontAwesomeIcon,`,
    `      backgroundColor: preset.backgroundColor,`,
    `    };`,
    `  }),`,
    `];`,
    ``,
    `const skillGroups = {};`,
    `list(dto.skills).forEach((skill) => {`,
    `  const category = text(skill.category, "Other");`,
    `  (skillGroups[category] = skillGroups[category] || []).push(skill);`,
    `});`,
    ``,
    `const skillImageNames = list(ASSETS.skillImages);`,
    `export const skills = {`,
    `  data: Object.keys(skillGroups).map((title, index) => ({`,
    `    title,`,
    `    fileName: skillImageNames[index % Math.max(skillImageNames.length, 1)] || "DesignImg",`,
    `    skills: skillGroups[title]`,
    `      .filter((skill) => text(skill.proficiency, ""))`,
    `      .map((skill) => \`\\u26A1 \${skill.name}: \${skill.proficiency}\`),`,
    `    softwareSkills: skillGroups[title].map((skill) => ({`,
    `      skillName: text(skill.name, "Skill"),`,
    `      fontAwesomeClassname: \`simple-icons:\${slug(skill.name)}\`,`
    ,
    `      style: { color: SKILL_COLORS[index % SKILL_COLORS.length] },`,
    `    })),`,
    `  })),`,
    `};`,
    ``,
    `export const degrees = {`,
    `  degrees: list(dto.education).map((entry) => ({`,
    `    title: text(entry.institution, "Institution"),`,
    `    subtitle: [text(entry.degree, ""), text(entry.fieldOfStudy, "")].filter(Boolean).join(" in "),`,
    `    logo_path: pickLogo(ASSETS.degreeLogos, entry.institution),`,
    `    alt_name: text(entry.institution, "Education"),`,
    `    duration: duration(entry.startDate, entry.endDate),`,
    `    descriptions: [`,
    `      text(entry.coursework, ""),`,
    `      entry.gpa ? \`\\u26A1 GPA \${entry.gpa}\${entry.gpaScale ? \` (\${entry.gpaScale})\` : ""}\` : "",`,
    `      text(entry.honors, ""),`,
    `      text(entry.location, ""),`,
    `    ].filter(Boolean),`,
    `    website_link: text(entry.website, ""),`,
    `  })),`,
    `};`,
    ``,
    `export const certifications = {`,
    `  certifications: HAS_ANY_SHIPPED_IMAGE`,
    `    ? list(dto.credentials).map((entry, index) => ({`,
    `        title: text(entry.title, "Credential"),`,
    `        subtitle: text(entry.issuer, "") ? \`- \${entry.issuer}\` : "",`,
    `        logo_path: pickLogo(ASSETS.certificationLogos, entry.issuer),`,
    `        certificate_link: text(entry.credentialUrl, text(entry.verificationUrl, "")),`,
    `        alt_name: text(entry.issuer, "Credential"),`,
    `        color_code: SKILL_COLORS[index % SKILL_COLORS.length],`,
    `      }))`,
    `    : [],`,
    `};`,
    ``,
    `/* PublicProfileDTO_v1 has no employment history, so no positions are rendered:`,
    `   the author's own jobs must never appear as student data. The devfolio shape`,
    `   is kept because components read experience.sections[].experiences[]. */`,
    `export const experience = {`,
    `  title: "Experience",`,
    `  subtitle: ${JSON.stringify(assets.experienceSubtitle)},`,
    `  description: text(profile.headline, ""),`,
    `  header_image_path: ${JSON.stringify(assets.experienceHeader)},`,
    `  sections: [],`,
    `};`,
    ``,
    `export const projectsHeader = {`,
    `  title: "Projects",`,
    `  description: text(profile.headline, "Projects listed in this profile."),`,
    `  avatar_image_path: ASSETS.projectsAvatar,`,
    `};`,
    ``,
    `export const contactPageData = {`,
    `  contactSection: {`,
    `    title: "Contact Me",`,
    `    profile_image_path: ASSETS.contactAvatar,`,
    `    description: text(profile.bio, text(profile.headline, "")),`,
    `  },`,
    `  blogSection: {`,
    `    title: "Blogs",`,
    `    subtitle: "",`,
    `    link: "",`,
    `    avatar_image_path: ASSETS.blogAvatar,`,
    `  },`,
    `};`,
  );

  for (const name of unmapped) {
    lines.push(`/* '${name}' has no PublicProfileDTO_v1 equivalent; base value kept. */`);
    lines.push(`export const ${name} = oneVueBase.${name};`);
  }

  return lines.join("\n") + "\n";
}

export function generateProjectsModuleSource(): string {
  return `/* ${GENERATED_MARKER} project list — do not edit; regenerated by OneVue adaptation. */
import { getOneVueProfile } from "./runtime.js";

const dto = getOneVueProfile();
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value, fallback) => (typeof value === "string" && value.trim() ? value : fallback || "");
const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default {
  data: list(dto.projects).map((project) => ({
    id: text(project.id, text(project.title, "project")),
    name: text(project.title, "Untitled project"),
    createdAt: text(project.startDate, ""),
    url: text(project.repoUrl, text(project.liveUrl, text(project.websiteUrl, text(project.docsUrl, "")))),
    description: text(project.shortDescription, text(project.detailedDescription, "")),
    isFork: false,
    languages: list(project.technologies).map((technology) => ({
      name: text(technology, ""),
      iconifyClass: \`logos-\${slug(technology)}\`,
    })),
  })),
};
`;
}

/* =========================================================================
   Strategy entry point
   ========================================================================= */

export function adaptCraDevfolioTemplate(input: CraAdapterInput): CraAdapterOutcome {
  const { adaptedDir, templateId, templateVersion, pkg } = input;
  const findings: CraFinding[] = [];
  const createdFiles: Array<{ relativePath: string; purpose: string }> = [];
  const modifiedFiles: Array<{ relativePath: string; purpose: string }> = [];

  const fail = (code: string, message: string, file?: string): CraAdapterOutcome => ({
    ok: false,
    status: "INCOMPATIBLE",
    findings: [...findings, { code, severity: "error", message, file }],
    createdFiles,
    modifiedFiles,
    error: message,
  });

  const basePath = releaseAssetBasePath(templateId, templateVersion);

  // 1. package.json — asset base path, deploy scripts, SW cleanup.
  const pkgPath = path.join(adaptedDir, "package.json");
  const originalHomepage = typeof pkg.homepage === "string" ? pkg.homepage : "";
  pkg.homepage = basePath;
  if (pkg.scripts) {
    delete pkg.scripts.predeploy;
    delete pkg.scripts.deploy;
  }
  const originalBuild = String(pkg?.scripts?.build || "react-scripts build");
  // CRA always emits a precached service worker; nothing in an iframe visitor
  // document can register it, so it is dropped before packaging.
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.build = `${originalBuild} && rm -f ${CRA_ARTIFACT_DIR}/service-worker.js ${CRA_ARTIFACT_DIR}/precache-manifest.*.js`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  modifiedFiles.push({ relativePath: "package.json", purpose: "Release asset base path, no deploy scripts, service worker removal" });
  findings.push({
    code: "CRA_HOMEPAGE_SET",
    severity: "info",
    message: `homepage set to '${basePath}' (was '${originalHomepage || "unset"}'), so webpack publicPath and every emitted asset URL resolve under the OneVue delivery path.`,
    file: "package.json",
  });

  // 2. CRA .env — the only isolation-preserving way to disable source maps.
  const envPath = path.join(adaptedDir, ".env");
  const envLines: string[] = [];
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      if (/^\s*(GENERATE_SOURCEMAP|INLINE_RUNTIME_CHUNK)\s*=/.test(line)) continue;
      envLines.push(line);
    }
  }
  envLines.push("GENERATE_SOURCEMAP=false");
  fs.writeFileSync(envPath, envLines.join("\n").replace(/\n*$/, "\n"), "utf8");
  createdFiles.push({ relativePath: ".env", purpose: "Disable production source maps" });
  findings.push({
    code: "CRA_SOURCEMAPS_DISABLED",
    severity: "info",
    message: "GENERATE_SOURCEMAP=false so the release ships no original source.",
    file: ".env",
  });

  // 3. public/index.html
  const indexHtmlPath = path.join(adaptedDir, "public", "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    return fail("MISSING_PUBLIC_INDEX_HTML", "A Create React App template requires public/index.html.", "public/index.html");
  }
  let html = fs.readFileSync(indexHtmlPath, "utf8");

  const tracking = stripThirdPartyTracking(html);
  html = tracking.html;
  if (tracking.removed.length > 0) {
    findings.push({
      code: "CRA_TRACKING_REMOVED",
      severity: "info",
      message: `Removed ${tracking.removed.length} analytics/advertising tag(s): ${tracking.removed.join(", ")}.`,
      file: "public/index.html",
    });
  }

  const sourceText = collectSourceText(adaptedDir);
  const reviews = reviewExternalTags(html, sourceText);
  const removable = reviews.filter((r) => r.decision.startsWith("remove")).map((r) => r.url);
  html = stripExternalTags(html, removable);
  for (const review of reviews) {
    if (review.decision === "keep-required" || review.decision === "keep-unreviewed") {
      findings.push({
        code: "CRA_CDN_KEPT",
        severity: "warning",
        message: `External dependency kept (${review.decision}): ${review.url} — ${review.reason}`,
        file: "public/index.html",
      });
    }
  }
  if (removable.length > 0) {
    findings.push({
      code: "CRA_CDN_REMOVED",
      severity: "info",
      message: `Removed ${removable.length} external tag(s): ${removable.join(", ")}.`,
      file: "public/index.html",
    });
  }

  const prefixed = prefixRootAbsoluteUrls(html, basePath);
  html = prefixed.html;
  if (prefixed.rewritten.length > 0) {
    findings.push({
      code: "CRA_ASSET_PATHS_PREFIXED",
      severity: "info",
      message: `Rewrote ${prefixed.rewritten.length} root-absolute URL(s) to the release base path.`,
      file: "public/index.html",
    });
  }

  const repaired = repairHeadMetadata(html);
  html = repaired.html;
  for (const fix of repaired.fixes) {
    findings.push({ code: "CRA_METADATA_REPAIRED", severity: "info", message: fix, file: "public/index.html" });
  }

  const placeholder = injectDtoPlaceholder(html);
  html = placeholder.html;
  if (placeholder.changed) {
    findings.push({
      code: "CRA_DTO_PLACEHOLDER_INJECTED",
      severity: "info",
      message: "Added the __ONEVUE_DTO__ script block the visitor renderer replaces.",
      file: "public/index.html",
    });
  }

  // 4. PWA support is unreachable from an iframe visitor document.
  const publicManifest = path.join(adaptedDir, "public", "manifest.json");
  if (fs.existsSync(publicManifest)) {
    fs.rmSync(publicManifest);
    html = html.replace(/<link\b[^>]*\brel\s*=\s*["']manifest["'][^>]*\/?>/gi, "");
    findings.push({
      code: "CRA_PWA_REMOVED",
      severity: "info",
      message: "Removed public/manifest.json and its <link rel=\"manifest\">: a srcdoc iframe cannot install a PWA.",
      file: "public/manifest.json",
    });
  }

  fs.writeFileSync(indexHtmlPath, html, "utf8");
  modifiedFiles.push({
    relativePath: "public/index.html",
    purpose: "Tracking removal, CDN review, base path, metadata repair, DTO placeholder, PWA link removal",
  });

  // 5. Router normalization for every file that mounts BrowserRouter.
  const routerFiles = findFilesWithBrowserRouter(adaptedDir);
  if (routerFiles.length === 0) {
    return fail(
      "CRA_ROUTER_UNSUPPORTED",
      "No BrowserRouter usage was found; the CRA strategy cannot guarantee visitor routing.",
      "src/"
    );
  }
  // The router file is not rewritten to import the runtime: reading the global
  // the runtime already publishes keeps this rewrite independent of the
  // template's import style.
  const initialEntriesExpression =
    '(typeof window !== "undefined" && window.__ONEVUE_ROUTE__) || "/"';
  for (const relative of routerFiles) {
    const absolute = path.join(adaptedDir, relative);
    const source = fs.readFileSync(absolute, "utf8");
    const outcome = normalizeBrowserRouter(source, { initialEntriesExpression });
    if (outcome.error) {
      return fail("CRA_ROUTER_REWRITE_REFUSED", `Refusing to rewrite router in '${relative}': ${outcome.error}`, relative);
    }
    if (outcome.changed) {
      fs.writeFileSync(absolute, outcome.content, "utf8");
      modifiedFiles.push({ relativePath: relative, purpose: "BrowserRouter normalized to MemoryRouter with the visitor deep-link route" });
      findings.push({
        code: "CRA_ROUTER_MEMORY",
        severity: "info",
        message: `BrowserRouter replaced with MemoryRouter in '${relative}' (history APIs are unavailable inside the visitor iframe).`,
        file: relative,
      });
    }
  }

  // 6. Harden unchecked reads of the content surface.
  for (const relative of listSourceFiles(adaptedDir)) {
    const absolute = path.join(adaptedDir, relative);
    const source = fs.readFileSync(absolute, "utf8");
    const hardened = hardenContentAccess(source);
    if (!hardened.changed) continue;
    fs.writeFileSync(absolute, hardened.source, "utf8");
    modifiedFiles.push({ relativePath: relative, purpose: `Content access hardened: ${hardened.fixes.join(", ")}` });
    findings.push({
      code: "CRA_CONTENT_ACCESS_HARDENED",
      severity: "info",
      message: `'${relative}': ${hardened.fixes.join("; ")}. Without this a student profile that has no job history or no email unmounts the whole app.`,
      file: relative,
    });
  }

  // 7. DTO-backed content module.
  const detection = detectCraDevfolio(adaptedDir, pkg);
  if (!detection.detected || !detection.contentModule) {
    return fail(
      "CRA_CONTENT_MODULE_NOT_FOUND",
      `The CRA strategy needs a devfolio content module exporting greeting + socialMediaLinks. ${detection.reasons.join(" ")}`,
      "src/"
    );
  }
  const contentRelative = detection.contentModule;
  const contentAbsolute = path.join(adaptedDir, contentRelative);
  const contentSource = fs.readFileSync(contentAbsolute, "utf8");
  const exportNames = readExportedNames(contentSource);
  const imageNames = listAssetImageNames(adaptedDir);
  const assets = sanitizeAssets(extractContentAssets(contentSource), imageNames);
  const generated = generateContentModuleSource(exportNames, assets, imageNames);
  const keepsBase = generated.includes("oneVueBase.");

  const runtimeAbsolute = path.join(adaptedDir, RUNTIME_MODULE_PATH);
  fs.mkdirSync(path.dirname(runtimeAbsolute), { recursive: true });
  fs.writeFileSync(runtimeAbsolute, runtimeModuleSource(), "utf8");
  createdFiles.push({ relativePath: RUNTIME_MODULE_PATH, purpose: "Reads the injected __ONEVUE_DTO__ payload and visitor route" });

  if (keepsBase) {
    fs.writeFileSync(path.join(adaptedDir, "src/onevue/portfolio.base.js"), contentSource, "utf8");
    createdFiles.push({ relativePath: "src/onevue/portfolio.base.js", purpose: "Original content module retained for exports the DTO cannot represent" });
    findings.push({
      code: "CRA_BASE_MODULE_RETAINED",
      severity: "warning",
      message: "The original content module is still imported because some exports have no DTO equivalent; author values remain reachable for those names.",
      file: contentRelative,
    });
  }

  fs.writeFileSync(contentAbsolute, generated, "utf8");
  createdFiles.push({ relativePath: contentRelative, purpose: "Generated DTO-backed content module (same export names)" });
  findings.push({
    code: "CRA_CONTENT_DTO_MAPPED",
    severity: "info",
    message: keepsBase
      ? `Content module '${contentRelative}' derives greeting, seo, social links, skills, education, credentials and contact from the DTO.`
      : `Content module '${contentRelative}' is fully DTO-derived and the author's content module is no longer shipped.`,
    file: contentRelative,
  });
  findings.push({
    code: "CRA_EXPERIENCE_EMPTY",
    severity: "warning",
    message: "PublicProfileDTO_v1 has no employment history, so the Experience section renders empty rather than showing the original author's positions.",
    file: contentRelative,
  });

  // 7. Committed personal data modules. Projects map to dto.projects; the
  //    author's contribution history has no DTO equivalent and is emptied.
  const dataImporters = findAuthorDataImporters(adaptedDir);
  if (dataImporters.projects.length === 0 && dataImporters.contributions.length === 0) {
    findings.push({
      code: "CRA_NO_COMMITTED_DATA",
      severity: "info",
      message: "The template imports no committed project or contribution data.",
    });
  }
  for (const importer of dataImporters.projects) {
    const absolute = path.join(adaptedDir, importer.file);
    const source = fs.readFileSync(absolute, "utf8");
    const specifier = relativeSpecifier(absolute, path.join(adaptedDir, PROJECTS_MODULE_PATH));
    const updated = replaceDefaultImport(source, importer.specifier, specifier);
    if (updated === source) {
      return fail("CRA_PROJECT_IMPORT_REWRITE_FAILED", `Could not rewrite the project data import in '${importer.file}'.`, importer.file);
    }
    fs.writeFileSync(absolute, updated, "utf8");
    modifiedFiles.push({ relativePath: importer.file, purpose: "Project data import redirected to the DTO-backed module" });
    findings.push({
      code: "CRA_PROJECTS_DTO_BACKED",
      severity: "info",
      message: `Rewrote '${importer.specifier}' to '${specifier}' so project cards render student data.`,
      file: importer.file,
    });
  }
  if (dataImporters.projects.length > 0) {
    const projectsAbsolute = path.join(adaptedDir, PROJECTS_MODULE_PATH);
    fs.mkdirSync(path.dirname(projectsAbsolute), { recursive: true });
    fs.writeFileSync(projectsAbsolute, generateProjectsModuleSource(), "utf8");
    createdFiles.push({ relativePath: PROJECTS_MODULE_PATH, purpose: "Project cards derived from dto.projects" });
  }

  for (const importer of dataImporters.contributions) {
    const kind = path.basename(importer.specifier, ".json");
    const generatedRelative = `src/onevue/${kind}.generated.js`;
    const absolute = path.join(adaptedDir, importer.file);
    const source = fs.readFileSync(absolute, "utf8");
    const specifier = relativeSpecifier(absolute, path.join(adaptedDir, generatedRelative));
    const updated = replaceDefaultImport(source, importer.specifier, specifier);
    if (updated === source) {
      return fail("CRA_CONTRIBUTION_IMPORT_REWRITE_FAILED", `Could not rewrite the contribution data import in '${importer.file}'.`, importer.file);
    }
    fs.writeFileSync(absolute, updated, "utf8");
    if (!fs.existsSync(path.join(adaptedDir, generatedRelative))) {
      fs.mkdirSync(path.dirname(path.join(adaptedDir, generatedRelative)), { recursive: true });
      fs.writeFileSync(path.join(adaptedDir, generatedRelative), generateEmptyContributionModule(kind), "utf8");
      createdFiles.push({ relativePath: generatedRelative, purpose: `Empty ${kind} list (no DTO equivalent)` });
    }
    modifiedFiles.push({ relativePath: importer.file, purpose: "Author contribution data replaced with an empty DTO-equivalent list" });
    findings.push({
      code: "CRA_CONTRIBUTIONS_REMOVED",
      severity: "warning",
      message: `'${importer.specifier}' carried the original author's ${kind}; redirected to an empty list because PublicProfileDTO_v1 has no contribution history.`,
      file: importer.file,
    });
  }

  return {
    ok: true,
    status: "ADAPTED",
    findings,
    createdFiles,
    modifiedFiles,
    buildScript: pkg.scripts.build,
    sections: deriveSupportedSections(),
  };
}

function relativeSpecifier(fromFile: string, toFile: string): string {
  const target = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/").replace(/\.js$/, "");
  return target.startsWith(".") ? target : `./${target}`;
}

function replaceDefaultImport(source: string, oldSpecifier: string, newSpecifier: string): string {
  const escaped = oldSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(
    new RegExp(`(import\\s+[A-Za-z_$][\\w$]*\\s+from\\s*)(["'])${escaped}\\2`),
    `$1${JSON.stringify(newSpecifier)}`
  );
}

/**
 * Image file names a CRA devfolio template can actually resolve through its
 * `require(../../assets/images/${name})` context.
 */
export function listAssetImageNames(sourceDir: string): string[] {
  const dir = path.join(sourceDir, "src", "assets", "images");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => /\.[a-z0-9]+$/i.test(entry) && fs.statSync(path.join(dir, entry)).isFile());
}

/**
 * An avatar or header image name that the template does not ship would throw
 * the same `Cannot find module` error an unknown logo would, so names are
 * checked against the real asset directory before they are emitted.
 */
export function sanitizeAssets(assets: ContentAssets, imageNames: string[]): ContentAssets {
  if (imageNames.length === 0) return assets;
  const available = new Set(imageNames);
  const pick = (name: string, alternatives: string[]): string => {
    if (available.has(name)) return name;
    return alternatives.find((candidate) => available.has(candidate)) || imageNames[0];
  };
  return {
    ...assets,
    projectsAvatar: pick(assets.projectsAvatar, ["projects_image.svg", "education.svg"]),
    contactAvatar: pick(assets.contactAvatar, ["avatar.svg", "contactMail.png"]),
    blogAvatar: pick(assets.blogAvatar, ["blogs_image.svg", "education.svg"]),
    experienceHeader: pick(assets.experienceHeader, ["experience.svg", "education.svg"]),
  };
}

function listSourceFiles(sourceDir: string): string[] {
  const srcDir = path.join(sourceDir, "src");
  if (!fs.existsSync(srcDir)) return [];
  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "onevue" || entry.name === "assets") continue;
        visit(full);
      } else if (/\.jsx?$/.test(entry.name)) {
        found.push(path.relative(sourceDir, full).replace(/\\/g, "/"));
      }
    }
  };
  visit(srcDir);
  return found;
}

export function findFilesWithBrowserRouter(sourceDir: string): string[] {
  const srcDir = path.join(sourceDir, "src");
  if (!fs.existsSync(srcDir)) return [];
  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "onevue") continue;
        visit(full);
      } else if (/\.jsx?$/.test(entry.name) && /<BrowserRouter\b/.test(fs.readFileSync(full, "utf8"))) {
        found.push(path.relative(sourceDir, full).replace(/\\/g, "/"));
      }
    }
  };
  visit(srcDir);
  return found;
}

/**
 * Templates in this family commit the author's GitHub history as JSON and
 * import it as a default export. Splitting the two kinds keeps the mapping
 * honest: projects have a DTO field, contributions do not.
 */
export function findAuthorDataImporters(
  sourceDir: string
): { projects: Array<{ file: string; specifier: string }>; contributions: Array<{ file: string; specifier: string }> } {
  const srcDir = path.join(sourceDir, "src");
  const projects: Array<{ file: string; specifier: string }> = [];
  const contributions: Array<{ file: string; specifier: string }> = [];
  if (!fs.existsSync(srcDir)) return { projects, contributions };

  const pattern = /import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']*opensource\/([a-z_]+)\.json)["']/g;
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "onevue") continue;
        visit(full);
      } else if (/\.jsx?$/.test(entry.name)) {
        const source = fs.readFileSync(full, "utf8");
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(source)) !== null) {
          const record = { file: path.relative(sourceDir, full).replace(/\\/g, "/"), specifier: match[2] };
          if (match[3] === "projects") projects.push(record);
          else if (CONTRIBUTION_MODULES.includes(match[3])) contributions.push(record);
        }
      }
    }
  };
  visit(srcDir);
  return { projects, contributions };
}

function collectSourceText(sourceDir: string): string {
  const srcDir = path.join(sourceDir, "src");
  if (!fs.existsSync(srcDir)) return "";
  let text = "";
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        visit(full);
      } else if (/\.(jsx?|css)$/.test(entry.name)) {
        try {
          text += fs.readFileSync(full, "utf8") + "\n";
        } catch {
          /* unreadable files simply do not contribute evidence */
        }
      }
    }
  };
  visit(srcDir);
  return text;
}
