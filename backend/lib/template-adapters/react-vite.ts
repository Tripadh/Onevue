/**
 * =========================================================================
 * OneVue Phase 6.2 — Reusable React + Vite Template Adaptation Strategy
 * =========================================================================
 *
 * Deterministic, fail-closed transformations applied to an isolated working
 * copy by the existing adaptation worker (template-adaptation.ts). This module
 * never executes repository code, installs dependencies, or touches the
 * original source directory.
 *
 * Transformations:
 *  1. Rewrite the Vite build command to use `--base=/templates/<id>/<version>/`
 *     (assets must be served from the immutable artifact path; the upstream
 *     `base` in vite.config is intentionally not parsed by fragile regexes).
 *  2. Inject the `#__ONEVUE_DTO__` placeholder into index.html.
 *  3. Generate a runtime DTO reader with validation and safe defaults, and load
 *     it before the app entry via a module script in index.html.
 *  4. Normalize supported `BrowserRouter` usage to `MemoryRouter` (required
 *     inside the visitor iframe srcDoc) without global string replacement.
 *  5. Reject EmailJS integrations (they perform third-party network calls and
 *     carry service credentials) with an actionable finding.
 *  6. Optionally generate a content module from a DECLARATIVE mapping file
 *     (`onevue.adapter.json`). Arbitrary template content is never guessed.
 *
 * Anything that cannot be transformed safely fails closed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type ReactViteFindingSeverity = "info" | "warning" | "error";

export interface ReactViteFinding {
  code: string;
  severity: ReactViteFindingSeverity;
  message: string;
  file?: string;
}

export interface ReactViteDetection {
  detected: boolean;
  evidence: string[];
  reasons: string[];
}

export interface ReactViteAdapterInput {
  adaptedDir: string;
  templateId: string;
  templateVersion: string;
  targetDtoVersion: string;
  pkg: any;
}

export interface ReactViteAdapterOutcome {
  ok: boolean;
  status: "COMPATIBLE" | "ADAPTED" | "INCOMPATIBLE" | "FAILED";
  findings: ReactViteFinding[];
  createdFiles: Array<{ relativePath: string; purpose: string }>;
  modifiedFiles: Array<{ relativePath: string; purpose: string }>;
  buildScript?: string;
  error?: string;
}

export const RUNTIME_MODULE_PATH = "src/onevue/runtime.js";
const RUNTIME_SCRIPT_SRC = "/src/onevue/runtime.js";
export const GENERATED_MARKER = "@onevue-generated";
const DTO_PLACEHOLDER = '<!-- <script type="application/json" id="__ONEVUE_DTO__">{}</script> -->';
const DTO_PLACEHOLDER_REGEX =
  /<!--\s*<script\s+type=["']application\/json["']\s+id=["']__ONEVUE_DTO__["']>[\s\S]*?<\/script>\s*-->/i;
const ACTIVE_DTO_SCRIPT_REGEX =
  /<script\s+type=["']application\/json["']\s+id=["']__ONEVUE_DTO__["']>[\s\S]*?<\/script>/i;

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

function isSafeTemplateIdentity(templateId: string, templateVersion: string): boolean {
  return (
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(templateId) &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(
      templateVersion
    )
  );
}

function walkFiles(root: string, visit: (relativePath: string, absolutePath: string) => void): void {
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        visit(path.relative(root, fullPath).replace(/\\/g, "/"), fullPath);
      }
    }
  };
  walk(root);
}

/* =========================================================================
   Detection — React AND Vite, never "any Vite project"
   ========================================================================= */

export function detectReactVite(sourceDir: string, pkg: any): ReactViteDetection {
  const evidence: string[] = [];
  const reasons: string[] = [];

  const hasViteConfig = ["vite.config.js", "vite.config.ts", "vite.config.mjs"].some((file) =>
    fs.existsSync(path.join(sourceDir, file))
  );
  if (hasViteConfig) evidence.push("vite.config");
  else reasons.push("No vite.config.{js,ts,mjs} was found.");

  const dependencies: Record<string, string> = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
  };
  const hasReact = typeof dependencies.react === "string";
  const hasReactDom = typeof dependencies["react-dom"] === "string";
  const hasReactPlugin =
    typeof dependencies["@vitejs/plugin-react"] === "string" ||
    typeof dependencies["@vitejs/plugin-react-swc"] === "string";

  if (hasReact) evidence.push("dependency:react");
  if (hasReactDom) evidence.push("dependency:react-dom");
  if (hasReactPlugin) evidence.push("dependency:@vitejs/plugin-react");

  let jsxFileCount = 0;
  let srcImportsReact = false;
  const srcRoot = path.join(sourceDir, "src");
  if (fs.existsSync(srcRoot)) {
    walkFiles(srcRoot, (relativePath, absolutePath) => {
      const ext = path.extname(relativePath).toLowerCase();
      if (ext === ".jsx" || ext === ".tsx") jsxFileCount += 1;
      if (!srcImportsReact && SOURCE_EXTENSIONS.has(ext)) {
        try {
          const content = fs.readFileSync(absolutePath, "utf8");
          if (/from\s+["']react["']|require\(\s*["']react["']\s*\)/.test(content)) {
            srcImportsReact = true;
          }
        } catch {
          // Unreadable source files are ignored for passive detection.
        }
      }
    });
  }
  if (jsxFileCount > 0) evidence.push(`jsx-files:${jsxFileCount}`);
  if (srcImportsReact) evidence.push("src-imports-react");

  const reactEvidence = hasReact && (hasReactDom || hasReactPlugin || jsxFileCount > 0 || srcImportsReact);
  if (!hasReact) reasons.push("package.json does not declare the 'react' dependency.");
  else if (!hasReactDom && !hasReactPlugin && jsxFileCount === 0 && !srcImportsReact) {
    reasons.push("React is declared but no React DOM/plugin/JSX evidence was found.");
  }

  return {
    detected: hasViteConfig && reactEvidence,
    evidence,
    reasons,
  };
}

/* =========================================================================
   Transform 1 — Vite base via the build command
   ========================================================================= */

const VITE_BUILD_TAIL = /^vite\s+build(\s+[\s\S]*)?$/;

export function rewriteViteBuildScript(
  buildScript: string,
  basePath: string
): { ok: boolean; script?: string; reason?: string } {
  const script = String(buildScript || "").trim();
  if (!script) return { ok: false, reason: "package.json has no build script." };

  const segments = script.split("&&").map((segment) => segment.trim());
  const tail = segments[segments.length - 1];
  if (!VITE_BUILD_TAIL.test(tail)) {
    return {
      ok: false,
      reason: `The build script must end with 'vite build' to set the artifact base safely; found '${tail}'.`,
    };
  }

  let updatedTail: string;
  const baseFlag = /--base(?:=|\s+)(\S+)/;
  if (baseFlag.test(tail)) {
    updatedTail = tail.replace(baseFlag, `--base=${basePath}`);
  } else {
    updatedTail = `${tail} --base=${basePath}`;
  }

  return { ok: true, script: [...segments.slice(0, -1), updatedTail].join(" && ") };
}

/* =========================================================================
   Transform 2 & 3 — DTO placeholder, runtime module, script injection
   ========================================================================= */

export function runtimeModuleSource(): string {
  return `/* ${GENERATED_MARKER} runtime — do not edit; regenerated by OneVue adaptation. */
const DEFAULT_PROFILE = Object.freeze({
  meta: { schemaVersion: "1.0.0", username: "", canonicalUrl: "", publishedAt: "", templateId: "", templateVersion: "" },
  profile: {
    displayName: "Student",
    preferredName: "",
    initials: "OV",
    headline: "",
    bio: "",
    profilePhoto: "",
    location: { city: "", state: "", country: "", formatted: "" },
    careerInterests: [],
    areasOfInterest: [],
    languages: [],
  },
  education: [],
  projects: [],
  skills: [],
  credentials: [],
  achievements: [],
  media: [],
  contact: { email: "", phone: "", socialLinks: [] },
});

function readInjectedPayload() {
  if (typeof document === "undefined") return null;
  const element = document.getElementById("__ONEVUE_DTO__");
  if (!element) return null;
  try {
    const parsed = JSON.parse(element.textContent || "{}");
    if (parsed && parsed.dto && parsed.dto.profile) {
      return { dto: parsed.dto, website: parsed.website || {} };
    }
    if (parsed && parsed.profile) {
      return { dto: parsed, website: {} };
    }
    return null;
  } catch {
    return null;
  }
}

export function getOneVuePayload() {
  return readInjectedPayload() || { dto: DEFAULT_PROFILE, website: {} };
}

export function getOneVueProfile() {
  return getOneVuePayload().dto;
}

/* The visitor page carries the template's deep link in the document URL, so a
   memory router can start at the same place a history router would have. */
export function getOneVueRoute() {
  const route = getOneVuePayload().website && getOneVuePayload().website.route;
  if (typeof route !== "string" || !route.startsWith("/") || route.includes("//")) return "/";
  return route;
}

if (typeof window !== "undefined") {
  const payload = getOneVuePayload();
  window.__ONEVUE_PAYLOAD__ = payload;
  window.__ONEVUE_PROFILE__ = payload.dto;
  window.__ONEVUE_ROUTE__ = getOneVueRoute();
}

export default getOneVueProfile;
`;
}

function findDtoPlaceholder(content: string): "placeholder" | "active" | "missing" {
  if (DTO_PLACEHOLDER_REGEX.test(content)) return "placeholder";
  if (ACTIVE_DTO_SCRIPT_REGEX.test(content)) return "active";
  return "missing";
}

/* =========================================================================
   Transform 4 — BrowserRouter -> MemoryRouter (safe, targeted)
   ========================================================================= */

const ROUTER_IMPORT_REGEX = /import\s*\{([^}]*)\}\s*from\s*(["'])react-router-dom\2\s*;?/g;

interface RouterImport {
  raw: string;
  specifiers: string[];
  browserIndex: number;
  alias: string;
  hasMemoryRouter: boolean;
}

function findBrowserRouterImport(content: string): RouterImport | null {
  ROUTER_IMPORT_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ROUTER_IMPORT_REGEX.exec(content)) !== null) {
    const specifiers = match[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const browserIndex = specifiers.findIndex(
      (entry) => entry === "BrowserRouter" || /^BrowserRouter\s+as\s+[A-Za-z_$][\w$]*$/.test(entry)
    );
    if (browserIndex === -1) continue;
    const aliasMatch = specifiers[browserIndex].match(/^BrowserRouter\s+as\s+([A-Za-z_$][\w$]*)$/);
    return {
      raw: match[0],
      specifiers,
      browserIndex,
      alias: aliasMatch ? aliasMatch[1] : "BrowserRouter",
      hasMemoryRouter: specifiers.some(
        (entry) => entry === "MemoryRouter" || /^MemoryRouter\s+as\s+/.test(entry)
      ),
    };
  }
  return null;
}

/**
 * Removes a `basename` attribute from a JSX opening tag. Fails on nested braces.
 *
 * The result is a discriminated union: a successful rewrite always carries the
 * rewritten tag, while a failure always carries the reason.
 */
function stripBasenameAttribute(
  tag: string
): { ok: true; tag: string; reason?: undefined } | { ok: false; tag?: undefined; reason: string } {
  const attributeIndex = tag.search(/\bbasename\s*=/);
  if (attributeIndex === -1) return { ok: true, tag };

  const valueStart = tag.indexOf("=", attributeIndex) + 1;
  let cursor = valueStart;
  while (cursor < tag.length && /\s/.test(tag[cursor])) cursor += 1;

  const quote = tag[cursor];
  let valueEnd = -1;
  if (quote === '"' || quote === "'") {
    valueEnd = tag.indexOf(quote, cursor + 1);
    if (valueEnd === -1) return { ok: false, reason: "Unterminated basename string." };
    valueEnd += 1;
  } else if (quote === "{") {
    let depth = 0;
    for (let i = cursor; i < tag.length; i += 1) {
      if (tag[i] === "{") depth += 1;
      else if (tag[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          valueEnd = i + 1;
          break;
        }
      }
    }
    if (valueEnd === -1) return { ok: false, reason: "Unterminated basename expression." };
  } else {
    return { ok: false, reason: "Unsupported basename attribute syntax." };
  }

  return { ok: true, tag: `${tag.slice(0, attributeIndex)}${tag.slice(valueEnd)}` };
}

export function normalizeBrowserRouter(
  content: string,
  options: { initialEntriesExpression?: string } = {}
): {
  changed: boolean;
  content: string;
  error?: string;
} {
  if (!content.includes("BrowserRouter")) return { changed: false, content };

  const importOccurrences = content.match(/BrowserRouter/g) || [];
  if (importOccurrences.length > 0 && (content.match(/from\s*["']react-router-dom["']/g) || []).length > 1) {
    return {
      changed: false,
      content,
      error: "Multiple react-router-dom imports reference BrowserRouter; refusing an ambiguous rewrite.",
    };
  }
  const routerImport = findBrowserRouterImport(content);
  if (!routerImport) {
    return {
      changed: false,
      content,
      error: "BrowserRouter is referenced but no static import from 'react-router-dom' was found.",
    };
  }
  if (routerImport.hasMemoryRouter) {
    return {
      changed: false,
      content,
      error: "The file already imports MemoryRouter alongside BrowserRouter; refusing an ambiguous rewrite.",
    };
  }

  const alias = routerImport.alias;
  if (alias !== "BrowserRouter" && /<BrowserRouter\b/.test(content)) {
    return {
      changed: false,
      content,
      error: "BrowserRouter is imported under an alias but the JSX still uses <BrowserRouter>; refusing an ambiguous rewrite.",
    };
  }
  let output = content;

  // Attribute rewrite on opening tags only.
  const tagRegex = new RegExp(`<${alias.replace(/\$/g, "\\$")}\\b([^>]*)>`, "g");
  const replacements: Array<{ original: string; updated: string }> = [];
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(output)) !== null) {
    const openingTag = tagMatch[0];
    const stripped = stripBasenameAttribute(openingTag);
    if (!stripped.ok) {
      return { changed: false, content, error: stripped.reason || "Unable to rewrite basename safely." };
    }
    if (stripped.tag !== openingTag) {
      replacements.push({ original: openingTag, updated: stripped.tag });
    }
  }
  for (const replacement of replacements) {
    output = output.split(replacement.original).join(replacement.updated);
  }

  // Import specifier: BrowserRouter -> MemoryRouter (alias preserved).
  const updatedSpecifiers = [...routerImport.specifiers];
  updatedSpecifiers[routerImport.browserIndex] =
    routerImport.browserIndex >= 0 && routerImport.specifiers[routerImport.browserIndex].includes(" as ")
      ? `MemoryRouter as ${alias}`
      : "MemoryRouter";
  const updatedImport = routerImport.raw.replace(
    routerImport.raw.slice(routerImport.raw.indexOf("{"), routerImport.raw.indexOf("}") + 1),
    `{ ${updatedSpecifiers.join(", ")} }`
  );
  output = output.replace(routerImport.raw, updatedImport);

  // Without an alias, the JSX tag itself must be renamed.
  if (alias === "BrowserRouter") {
    output = output.replace(/<BrowserRouter\b/g, "<MemoryRouter");
    output = output.replace(/<\/BrowserRouter>/g, "</MemoryRouter>");
  }

  // A memory router has no address bar to read, so the visitor's deep link has
  // to be handed to it explicitly or every refresh lands on the home route.
  if (options.initialEntriesExpression) {
    const tagName = alias === "BrowserRouter" ? "MemoryRouter" : alias;
    const tagRegex = new RegExp(`<${tagName.replace(/\$/g, "\\$")}\\b([^>]*)>`, "g");
    output = output.replace(tagRegex, (fullTag, attributes: string) => {
      if (/\binitialEntries\s*=/.test(attributes)) return fullTag;
      return `<${tagName} initialEntries={[${options.initialEntriesExpression}]}${attributes}>`;
    });
  }

  return { changed: output !== content, content: output };
}

/* =========================================================================
   Transform 5 — EmailJS rejection
   ========================================================================= */

const EMAILJS_PATTERNS = [/@emailjs\/browser/, /from\s+["']emailjs-com["']/, /emailjs\.send\s*\(/];

export function findEmailJsUsage(sourceDir: string, pkg: any): string[] {
  const hits: string[] = [];
  const dependencies = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (dependencies["@emailjs/browser"] || dependencies["emailjs-com"]) {
    hits.push("package.json");
  }
  walkFiles(sourceDir, (relativePath, absolutePath) => {
    const ext = path.extname(relativePath).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) return;
    try {
      const content = fs.readFileSync(absolutePath, "utf8");
      if (EMAILJS_PATTERNS.some((pattern) => pattern.test(content))) hits.push(relativePath);
    } catch {
      // Unreadable files cannot be introspected; they are ignored here.
    }
  });
  return Array.from(new Set(hits));
}

/* =========================================================================
   Transform 6 — Declarative content mapping (optional)
   ========================================================================= */

export interface ContentMapDeclaration {
  version: 1;
  targetModule: string;
  exports: Record<string, unknown>;
}

export function readContentMapDeclaration(sourceDir: string): {
  declaration?: ContentMapDeclaration;
  errors: string[];
} {
  const file = path.join(sourceDir, "onevue.adapter.json");
  if (!fs.existsSync(file)) return { errors: [] };

  const errors: string[] = [];
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { errors: [`onevue.adapter.json is malformed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  if (parsed?.version !== 1) errors.push("onevue.adapter.json must declare version 1.");
  const targetModule = typeof parsed?.targetModule === "string" ? parsed.targetModule.trim() : "";
  if (
    !targetModule ||
    !targetModule.startsWith("src/") ||
    targetModule.includes("..") ||
    !/\.(js|mjs|ts)$/.test(targetModule)
  ) {
    errors.push("targetModule must be a .js/.mjs/.ts path under src/ without traversal.");
  }
  const exportsDeclaration = parsed?.exports;
  if (!exportsDeclaration || typeof exportsDeclaration !== "object" || Array.isArray(exportsDeclaration)) {
    errors.push("exports must be an object.");
  } else {
    for (const key of Object.keys(exportsDeclaration)) {
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) errors.push(`Export name '${key}' is not a valid identifier.`);
    }
    if (Object.keys(exportsDeclaration).length === 0) errors.push("exports must not be empty.");
  }

  if (errors.length > 0) return { errors };
  return {
    declaration: {
      version: 1,
      targetModule,
      exports: exportsDeclaration,
    },
    errors: [],
  };
}

function emitMappedValue(value: any, indent: string, errors: string[]): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const entries = value.map((entry) => `${indent}  ${emitMappedValue(entry, indent + "  ", errors)}`);
    return `[\n${entries.join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if ("dto" in value) {
      const allowed = Object.keys(value).every((key) => key === "dto" || key === "default");
      if (!allowed) {
        errors.push("A dto reference may only be combined with a 'default' value.");
        return "null";
      }
      const dtoPath = value.dto;
      if (typeof dtoPath !== "string" || !/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(dtoPath)) {
        errors.push(`Invalid DTO path '${String(dtoPath)}'.`);
        return "null";
      }
      return `pick("${dtoPath}", ${emitMappedValue(value.default === undefined ? null : value.default, indent, errors)})`;
    }
    const entries = keys.map(
      (key) => `${indent}  ${JSON.stringify(key)}: ${emitMappedValue(value[key], indent + "  ", errors)}`
    );
    return `{\n${entries.join(",\n")}\n${indent}}`;
  }
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

export function generateContentModule(
  declaration: ContentMapDeclaration,
  runtimeRelativeImport: string
): { content?: string; errors: string[] } {
  const errors: string[] = [];
  const exportEntries = Object.entries(declaration.exports).map(
    ([key, value]) => `export const ${key} = ${emitMappedValue(value, "", errors)};`
  );
  if (errors.length > 0) return { errors };

  return {
    content: `/* ${GENERATED_MARKER} content map — generated from onevue.adapter.json. */
import { getOneVueProfile } from ${JSON.stringify(runtimeRelativeImport)};

const dto = getOneVueProfile();
const pick = (path, fallback) => {
  const value = String(path)
    .split(".")
    .reduce((current, key) => (current == null ? undefined : current[key]), dto);
  return value === undefined || value === null ? fallback : value;
};

${exportEntries.join("\n\n")}
`,
    errors: [],
  };
}

/* =========================================================================
   Strategy entry point
   ========================================================================= */

export function adaptReactViteTemplate(input: ReactViteAdapterInput): ReactViteAdapterOutcome {
  const findings: ReactViteFinding[] = [];
  const createdFiles: Array<{ relativePath: string; purpose: string }> = [];
  const modifiedFiles: Array<{ relativePath: string; purpose: string }> = [];
  let changed = false;

  const fail = (code: string, message: string, file?: string): ReactViteAdapterOutcome => ({
    ok: false,
    status: "INCOMPATIBLE",
    findings: [...findings, { code, severity: "error", message, file }],
    createdFiles,
    modifiedFiles,
    error: message,
  });

  const { adaptedDir, templateId, templateVersion } = input;
  if (!isSafeTemplateIdentity(templateId, templateVersion)) {
    return fail("INVALID_IDENTITY", "Template identity is invalid for the react-vite strategy.");
  }

  const indexPath = path.join(adaptedDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return fail("MISSING_INDEX_HTML", "index.html is required at the project root for a Vite template.", "index.html");
  }

  // EmailJS must be removed, not silently left active.
  const emailJsHits = findEmailJsUsage(adaptedDir, input.pkg);
  if (emailJsHits.length > 0) {
    return fail(
      "EMAILJS_REQUIRES_REMOVAL",
      `EmailJS is integrated (${emailJsHits.join(", ")}). Remove the @emailjs/browser dependency, the import and the emailjs.send call, and replace the contact form with a mailto:/link-based flow before adapting this template.`,
      emailJsHits[0]
    );
  }

  // Custom Vite outDir cannot be honored by the artifact contract.
  for (const configFile of ["vite.config.js", "vite.config.ts", "vite.config.mjs"]) {
    const configPath = path.join(adaptedDir, configFile);
    if (!fs.existsSync(configPath)) continue;
    const configContent = fs.readFileSync(configPath, "utf8");
    const outDirMatch = configContent.match(/outDir\s*:\s*["']([^"']+)["']/);
    if (outDirMatch && outDirMatch[1].replace(/\/+$/, "") !== "dist") {
      return fail(
        "CUSTOM_OUT_DIR_UNSUPPORTED",
        `Vite build.outDir '${outDirMatch[1]}' is not supported; the artifact contract requires 'dist/index.html'. Remove the override or emit to dist.`,
        configFile
      );
    }
  }

  const basePath = `/templates/${templateId}/${templateVersion}/`;
  const packageJsonPath = path.join(adaptedDir, "package.json");
  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (err) {
    return fail("MALFORMED_MANIFEST", `package.json is unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const buildScript = pkg?.scripts?.build;
  const rewritten = rewriteViteBuildScript(buildScript, basePath);
  if (!rewritten.ok) {
    return fail("UNSAFE_VITE_BUILD_SCRIPT", rewritten.reason || "The Vite build script cannot be adapted safely.", "package.json");
  }
  if (rewritten.script !== String(buildScript).trim()) {
    pkg.scripts.build = rewritten.script;
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    modifiedFiles.push({ relativePath: "package.json", purpose: `Vite base set to ${basePath} via --base` });
    findings.push({
      code: "VITE_BASE_APPLIED",
      severity: "info",
      message: `Build script now uses --base=${basePath} so assets resolve from the immutable artifact path.`,
      file: "package.json",
    });
    changed = true;
  } else {
    findings.push({ code: "VITE_BASE_PRESENT", severity: "info", message: "Build script already targets the artifact base path." });
  }

  // Runtime DTO reader (idempotent, refuses to clobber foreign modules).
  const runtimePath = path.join(adaptedDir, RUNTIME_MODULE_PATH);
  if (fs.existsSync(runtimePath)) {
    const existing = fs.readFileSync(runtimePath, "utf8");
    if (!existing.includes(GENERATED_MARKER)) {
      return fail(
        "RUNTIME_CONFLICT",
        `'${RUNTIME_MODULE_PATH}' already exists and was not generated by OneVue; refusing to overwrite it.`,
        RUNTIME_MODULE_PATH
      );
    }
    findings.push({ code: "RUNTIME_PRESENT", severity: "info", message: "OneVue DTO runtime reader already present." });
  } else {
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, runtimeModuleSource(), "utf8");
    createdFiles.push({ relativePath: RUNTIME_MODULE_PATH, purpose: "OneVue DTO runtime reader with validation and defaults" });
    findings.push({
      code: "RUNTIME_GENERATED",
      severity: "info",
      message: "Generated the DTO runtime reader; it reads #__ONEVUE_DTO__ and falls back to safe defaults.",
      file: RUNTIME_MODULE_PATH,
    });
    changed = true;
  }

  // DTO placeholder + runtime script in index.html.
  let indexHtml = fs.readFileSync(indexPath, "utf8");
  let indexChanged = false;
  const placeholderState = findDtoPlaceholder(indexHtml);
  if (placeholderState === "missing") {
    if (!indexHtml.includes("</head>")) {
      return fail("DTO_PLACEHOLDER_UNSAFE", "index.html has no </head>; cannot inject the OneVue DTO placeholder safely.", "index.html");
    }
    indexHtml = indexHtml.replace(
      "</head>",
      `  ${DTO_PLACEHOLDER}\n    <script type="module" src="${RUNTIME_SCRIPT_SRC}"></script>\n  </head>`
    );
    indexChanged = true;
    findings.push({
      code: "DTO_PLACEHOLDER_ADDED",
      severity: "info",
      message: "Injected the OneVue DTO placeholder and runtime script into index.html.",
      file: "index.html",
    });
  } else if (!indexHtml.includes(RUNTIME_SCRIPT_SRC)) {
    if (!indexHtml.includes("</head>")) {
      return fail("DTO_RUNTIME_UNSAFE", "index.html has no </head>; cannot load the DTO runtime reader safely.", "index.html");
    }
    indexHtml = indexHtml.replace("</head>", `    <script type="module" src="${RUNTIME_SCRIPT_SRC}"></script>\n  </head>`);
    indexChanged = true;
    findings.push({
      code: "RUNTIME_SCRIPT_ADDED",
      severity: "info",
      message: "Injected the DTO runtime module script into index.html.",
      file: "index.html",
    });
  } else {
    findings.push({ code: "DTO_PLACEHOLDER_PRESENT", severity: "info", message: "index.html already contains the DTO placeholder and runtime script." });
  }
  if (indexChanged) {
    fs.writeFileSync(indexPath, indexHtml, "utf8");
    modifiedFiles.push({ relativePath: "index.html", purpose: "OneVue DTO placeholder and runtime script" });
    changed = true;
  }

  // Router normalization.
  let routerFiles = 0;
  let normalizedFiles = 0;
  walkFiles(adaptedDir, (relativePath, absolutePath) => {
    const ext = path.extname(relativePath).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) return;
    let content: string;
    try {
      content = fs.readFileSync(absolutePath, "utf8");
    } catch {
      return;
    }
    if (content.includes("HashRouter")) {
      findings.push({
        code: "HASHROUTER_UNCHANGED",
        severity: "warning",
        message: "HashRouter was left unchanged; verify in-iframe navigation manually.",
        file: relativePath,
      });
    }
    if (!content.includes("BrowserRouter")) return;
    routerFiles += 1;
    const result = normalizeBrowserRouter(content);
    if (result.error) {
      findings.push({
        code: "ROUTER_TRANSFORM_UNSAFE",
        severity: "error",
        message: `BrowserRouter could not be normalized safely: ${result.error}`,
        file: relativePath,
      });
      return;
    }
    if (result.changed) {
      fs.writeFileSync(absolutePath, result.content, "utf8");
      normalizedFiles += 1;
      modifiedFiles.push({ relativePath, purpose: "BrowserRouter normalized to MemoryRouter for iframe rendering" });
      findings.push({
        code: "ROUTER_NORMALIZED",
        severity: "info",
        message: "BrowserRouter import/tag normalized to MemoryRouter (basename removed).",
        file: relativePath,
      });
      changed = true;
    }
  });
  if (routerFiles === 0) {
    findings.push({ code: "ROUTER_NONE", severity: "info", message: "No BrowserRouter usage was found; no router change was needed." });
  }

  const routerErrors = findings.filter((finding) => finding.code === "ROUTER_TRANSFORM_UNSAFE");
  if (routerErrors.length > 0) {
    return {
      ok: false,
      status: "INCOMPATIBLE",
      findings,
      createdFiles,
      modifiedFiles,
      error: "BrowserRouter usage could not be normalized safely. No artifact can be built until this is resolved.",
    };
  }

  // Declarative content mapping (optional; never guessed).
  const declarationResult = readContentMapDeclaration(adaptedDir);
  if (declarationResult.errors.length > 0) {
    return {
      ok: false,
      status: "INCOMPATIBLE",
      findings: [
        ...findings,
        {
          code: "CONTENT_MAP_INVALID",
          severity: "error",
          message: `Invalid onevue.adapter.json: ${declarationResult.errors.join(" ")}`,
          file: "onevue.adapter.json",
        },
      ],
      createdFiles,
      modifiedFiles,
      error: "The declarative content map is invalid.",
    };
  }
  if (declarationResult.declaration) {
    const declaration = declarationResult.declaration;
    const targetPath = path.join(adaptedDir, declaration.targetModule);
    if (fs.existsSync(targetPath) && !fs.readFileSync(targetPath, "utf8").includes(GENERATED_MARKER)) {
      return {
        ok: false,
        status: "INCOMPATIBLE",
        findings: [
          ...findings,
          {
            code: "CONTENT_TARGET_CONFLICT",
            severity: "error",
            message: `'${declaration.targetModule}' already exists and was not generated by OneVue; refusing to overwrite it.`,
            file: declaration.targetModule,
          },
        ],
        createdFiles,
        modifiedFiles,
        error: "The content map target conflicts with an existing file.",
      };
    }
    const runtimeImport = path
      .relative(path.dirname(declaration.targetModule), RUNTIME_MODULE_PATH)
      .replace(/\\/g, "/");
    const normalizedImport = runtimeImport.startsWith(".") ? runtimeImport : `./${runtimeImport}`;
    const generated = generateContentModule(declaration, normalizedImport);
    if (generated.errors.length > 0) {
      return {
        ok: false,
        status: "INCOMPATIBLE",
        findings: [
          ...findings,
          {
            code: "CONTENT_MAP_INVALID",
            severity: "error",
            message: `Content map errors: ${generated.errors.join(" ")}`,
            file: "onevue.adapter.json",
          },
        ],
        createdFiles,
        modifiedFiles,
        error: "The declarative content map is invalid.",
      };
    }
    const alreadyIdentical =
      fs.existsSync(targetPath) && fs.readFileSync(targetPath, "utf8") === generated.content;
    if (!alreadyIdentical) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, generated.content!, "utf8");
      createdFiles.push({
        relativePath: declaration.targetModule,
        purpose: "Generated content module from the declarative OneVue mapping",
      });
      findings.push({
        code: "CONTENT_MAP_GENERATED",
        severity: "info",
        message: `Generated '${declaration.targetModule}' from onevue.adapter.json.`,
        file: declaration.targetModule,
      });
      changed = true;
    } else {
      findings.push({
        code: "CONTENT_MAP_PRESENT",
        severity: "info",
        message: `'${declaration.targetModule}' is already up to date.`,
        file: declaration.targetModule,
      });
    }
    findings.push({
      code: "MANUAL_CONTENT_WIRING_REQUIRED",
      severity: "warning",
      message:
        "Import the generated content module from the template's pages (replacing its hardcoded content module). OneVue does not rewrite arbitrary template imports automatically.",
      file: declaration.targetModule,
    });
  } else {
    findings.push({
      code: "CONTENT_MAPPING_REQUIRED",
      severity: "warning",
      message:
        "No onevue.adapter.json mapping was provided. DTO data is available via getOneVueProfile(), but hardcoded template content was NOT replaced. Declare a mapping to generate a content module.",
    });
  }

  return {
    ok: true,
    status: changed ? "ADAPTED" : "COMPATIBLE",
    findings,
    createdFiles,
    modifiedFiles,
    buildScript: rewritten.script,
  };
}
