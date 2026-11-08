/**
 * =========================================================================
 * OneVue Phase 5.3 — Automated Template Adaptation & Compatibility Worker
 * =========================================================================
 *
 * Core architectural guarantees:
 * 1. Typed adaptation and build-readiness contract.
 * 2. Source immutability: Original source directory is NEVER modified in-place.
 *    All operations execute within an isolated temporary working directory.
 * 3. Compatibility-first adaptation: Detects framework, build configuration,
 *    manifest, and DTO adapter passively. Refuses ambiguous or incompatible structures.
 * 4. Deterministic proposed patch generation: If manifest or adapter is missing,
 *    generates an isolated working copy with OneVue PublicProfileDTO_v1 compatibility.
 * 5. Input & filesystem safety: Traversal, symlink, secret (.env), and file-size barriers.
 * 6. Build boundary: Zero package installations, zero lifecycle scripts, zero untrusted code execution.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SourceProvenance } from "./template-provisioning";
import { PUBLIC_PROFILE_SCHEMA_VERSION } from "./public-profile-dto";
import {
  adaptReactViteTemplate,
  detectReactVite,
  type ReactViteFinding,
} from "./template-adapters/react-vite";
import {
  adaptCraDevfolioTemplate,
  detectCraDevfolio,
  releaseAssetBasePath,
} from "./template-adapters/cra-devfolio";

/* =========================================================================
   Types and Interfaces
   ========================================================================= */

export type AdaptationStatus = "COMPATIBLE" | "INCOMPATIBLE" | "ADAPTED" | "FAILED";

export interface AdaptationFinding {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  file?: string;
}

export interface BuildReadiness {
  readyToBuild: boolean;
  framework: string;
  packageManager: "npm" | "pnpm" | "yarn" | "unknown";
  buildScript?: string;
  entrypoint: string;
  expectedArtifactPath: string;
  /**
   * Portfolio sections the adapted template really renders from the DTO.
   * Deliberately absent rather than guessed: the catalog must not advertise a
   * section the template cannot fill with student data.
   */
  supportedSections?: string[];
  notes?: string;
}

/**
 * Provenance metadata recorded alongside an adaptation.
 *
 * Adaptation never interprets these fields — it only carries them through to
 * the adaptation result — so the shape is intentionally open: the lifecycle
 * records `{ sourceCommitSha, ingestionId }` while the provisioning pipeline
 * records the fuller `SourceProvenance`. Callers may supply either.
 */
export type AdaptationProvenance = Partial<SourceProvenance> & {
  sourceCommitSha?: string;
  ingestionId?: string;
};

export type AdaptationStrategy = "magicui-vite" | "static-standard" | "react-vite" | "create-react-app";

export interface AdaptationInput {
  sourceDir: string;
  templateId: string;
  templateVersion: string;
  targetDtoVersion?: string; // Default: "1.0.0"
  strategy?: AdaptationStrategy;
  provenance?: AdaptationProvenance;
  approvedReviewRecord?: {
    status: string;
    auditReport?: { outcome: string };
    reviewDecision?: { decision: string; reason?: string };
  };
}

export interface AdaptationResult {
  status: AdaptationStatus;
  templateId: string;
  templateVersion: string;
  targetDtoVersion: string;
  provenance?: AdaptationProvenance;
  sourceDir: string;
  adaptedDir?: string;
  createdFiles: Array<{ relativePath: string; purpose: string }>;
  modifiedFiles: Array<{ relativePath: string; purpose: string }>;
  findings: AdaptationFinding[];
  buildReadiness: BuildReadiness;
  cleanup?: () => Promise<void>;
  error?: string;
}
const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SEMVER_REGEX = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

/* =========================================================================
   Secret & Sensitive File Filtering Rules (Shared with Phase 4.5)
   ========================================================================= */

const FORBIDDEN_FILE_PATTERNS = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.htpasswd$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.git(\/|$)/,
  /node_modules(\/|$)/,
  /dist(\/|$)/,
  /\.DS_Store$/,
  /Thumbs\.db$/,
];

function isForbiddenFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Safely copies source files into an isolated temporary working directory.
 * Preserves source immutability, blocks symlinks, and excludes secrets.
 */
function createIsolatedWorkingCopy(
  sourceDir: string,
  options: { maxFiles?: number; maxFileSizeBytes?: number } = {}
): { adaptedDir: string; filesCopied: number; cleanup: () => Promise<void> } {
  const maxFiles = options.maxFiles || 2500;
  const maxFileSizeBytes = options.maxFileSizeBytes || 10 * 1024 * 1024; // 10 MB

  const canonicalSource = path.resolve(sourceDir);
  const adaptedDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-adapt-"));
  const canonicalAdapted = path.resolve(adaptedDir);

  const cleanup = async () => {
    try {
      if (fs.existsSync(canonicalAdapted)) {
        fs.rmSync(canonicalAdapted, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  };

  let filesCopied = 0;

  const copyRecursively = (currentSrc: string, currentDest: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentSrc, { withFileTypes: true });
    } catch {
      return;
    }

    fs.mkdirSync(currentDest, { recursive: true });

    for (const entry of entries) {
      const srcPath = path.join(currentSrc, entry.name);
      const destPath = path.join(currentDest, entry.name);
      const relativePath = path.relative(canonicalSource, srcPath).replace(/\\/g, "/");

      // Symlink barrier check
      try {
        const lstat = fs.lstatSync(srcPath);
        if (lstat.isSymbolicLink()) {
          continue; // Skip symlinks
        }
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        if (!isForbiddenFile(relativePath + "/")) {
          copyRecursively(srcPath, destPath);
        }
      } else if (entry.isFile()) {
        if (!isForbiddenFile(relativePath)) {
          try {
            const stat = fs.statSync(srcPath);
            if (stat.size <= maxFileSizeBytes) {
              filesCopied++;
              if (filesCopied > maxFiles) {
                throw new Error(`File count exceeds safety limit (${maxFiles}).`);
              }
              fs.copyFileSync(srcPath, destPath);
            }
          } catch (err: any) {
            if (err?.message?.includes("File count exceeds")) throw err;
          }
        }
      }
    }
  };

  try {
    copyRecursively(canonicalSource, canonicalAdapted);
    return { adaptedDir: canonicalAdapted, filesCopied, cleanup };
  } catch (err) {
    fs.rmSync(canonicalAdapted, { recursive: true, force: true });
    throw err;
  }
}

/* =========================================================================
   Deterministic Adaptation Patch Generators
   ========================================================================= */

/**
 * Generates deterministic OneVue manifest file content if missing.
 */
function generateTemplateManifestCode(templateId: string, version: string, dtoVersion: string): string {
  return `/**
 * OneVue Template Manifest — Canonical Template ID: ${templateId}
 * Generated automatically by OneVue Adaptation Worker (Phase 5.3)
 */

export const TEMPLATE_ID = "${templateId}" as const;
export const TEMPLATE_VERSION = "${version}" as const;
export const SUPPORTED_DTO_SCHEMA_VERSION = "${dtoVersion}" as const;

export interface TemplateManifest {
  id: typeof TEMPLATE_ID;
  version: typeof TEMPLATE_VERSION;
  name: string;
  description: string;
  supportedDtoVersion: typeof SUPPORTED_DTO_SCHEMA_VERSION;
  supportedSections: readonly string[];
  customizationOptions: {
    supportsAccentColor: boolean;
    supportsThemeMode: boolean;
    defaultAccentColor: string;
    defaultThemeMode: "light" | "dark" | "system";
  };
}

export const TEMPLATE_MANIFEST: TemplateManifest = {
  id: TEMPLATE_ID,
  version: TEMPLATE_VERSION,
  name: "${templateId}",
  description: "OneVue adapted portfolio template.",
  supportedDtoVersion: SUPPORTED_DTO_SCHEMA_VERSION,
  supportedSections: [
    "hero",
    "about",
    "education",
    "skills",
    "projects",
    "work",
    "hackathons",
    "credentials",
    "contact",
  ],
  customizationOptions: {
    supportsAccentColor: true,
    supportsThemeMode: true,
    defaultAccentColor: "#3b82f6",
    defaultThemeMode: "system",
  },
};
`;
}

/* =========================================================================
   Main Adaptation Engine
   ========================================================================= */

/**
 * Executes a controlled, passive adaptation audit and compatibility verification.
 * Guarantees:
 * - Source directory is never modified.
 * - Framework compatibility is verified before making changes.
 * - Missing manifests/adapters receive deterministic proposed patches in isolated working dir.
 * - Build-readiness is reported for Phase 5.4 without executing untrusted builds.
 */
export async function adaptTemplateSource(input: AdaptationInput): Promise<AdaptationResult> {
  const {
    sourceDir,
    templateId,
    templateVersion,
    targetDtoVersion = PUBLIC_PROFILE_SCHEMA_VERSION,
    strategy: requestedStrategy,
    provenance,
    approvedReviewRecord,
  } = input;

  const findings: AdaptationFinding[] = [];
  const createdFiles: Array<{ relativePath: string; purpose: string }> = [];
  const modifiedFiles: Array<{ relativePath: string; purpose: string }> = [];

  const defaultReadiness: BuildReadiness = {
    readyToBuild: false,
    framework: "unknown",
    packageManager: "unknown",
    entrypoint: "index.html",
    expectedArtifactPath: "dist/index.html",
  };

  // 1. Invariant & Input Validation
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return {
      status: "FAILED",
      templateId,
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir: sourceDir || "",
      createdFiles: [],
      modifiedFiles: [],
      findings: [{ code: "SRC_NOT_FOUND", severity: "error", message: `Source directory does not exist: '${sourceDir}'.` }],
      buildReadiness: defaultReadiness,
      error: `Source directory does not exist: '${sourceDir}'.`,
    };
  }

  if (!templateId || !TEMPLATE_ID_REGEX.test(templateId.trim())) {
    return {
      status: "FAILED",
      templateId: templateId || "",
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{ code: "INVALID_TEMPLATE_ID", severity: "error", message: `Invalid templateId format: '${templateId}'.` }],
      buildReadiness: defaultReadiness,
      error: `Invalid templateId format: '${templateId}'.`,
    };
  }

  if (!templateVersion || !SEMVER_REGEX.test(templateVersion.trim())) {
    return {
      status: "FAILED",
      templateId,
      templateVersion: templateVersion || "",
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{ code: "INVALID_TEMPLATE_VERSION", severity: "error", message: `Invalid templateVersion semver format: '${templateVersion}'.` }],
      buildReadiness: defaultReadiness,
      error: `Invalid templateVersion semver format: '${templateVersion}'.`,
    };
  }

  if (targetDtoVersion !== PUBLIC_PROFILE_SCHEMA_VERSION) {
    return {
      status: "INCOMPATIBLE",
      templateId,
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{
        code: "UNSUPPORTED_DTO_VERSION",
        severity: "error",
        message: `Target DTO version '${targetDtoVersion}' is unsupported. Only '${PUBLIC_PROFILE_SCHEMA_VERSION}' is supported.`,
      }],
      buildReadiness: defaultReadiness,
      error: `Target DTO version '${targetDtoVersion}' is unsupported.`,
    };
  }

  // 2. Provenance & Review Approval Validation
  if (approvedReviewRecord) {
    if (approvedReviewRecord.status !== "approved") {
      return {
        status: "FAILED",
        templateId,
        templateVersion,
        targetDtoVersion,
        provenance,
        sourceDir,
        createdFiles: [],
        modifiedFiles: [],
        findings: [{
          code: "APPROVAL_REQUIRED",
          severity: "error",
          message: `Cannot adapt template: Ingestion review status is '${approvedReviewRecord.status}'. Only 'approved' templates can be adapted.`,
        }],
        buildReadiness: defaultReadiness,
        error: "Template review is not in approved status.",
      };
    }
  }

  // 3. Passive Manifest & Framework Inspection
  const pkgPath = path.join(sourceDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return {
      status: "INCOMPATIBLE",
      templateId,
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{ code: "MISSING_MANIFEST", severity: "error", message: "package.json is missing from source root." }],
      buildReadiness: defaultReadiness,
      error: "Missing package.json manifest.",
    };
  }

  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (err) {
    return {
      status: "INCOMPATIBLE",
      templateId,
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{ code: "MALFORMED_MANIFEST", severity: "error", message: `package.json is malformed: ${err instanceof Error ? err.message : String(err)}` }],
      buildReadiness: defaultReadiness,
      error: "Malformed package.json manifest.",
    };
  }

  // Detect Framework
  let detectedFramework = "unknown";
  const hasViteConfig = fs.existsSync(path.join(sourceDir, "vite.config.ts")) ||
    fs.existsSync(path.join(sourceDir, "vite.config.js")) ||
    fs.existsSync(path.join(sourceDir, "vite.config.mjs"));

  const hasNextConfig = fs.existsSync(path.join(sourceDir, "next.config.ts")) ||
    fs.existsSync(path.join(sourceDir, "next.config.js")) ||
    fs.existsSync(path.join(sourceDir, "next.config.mjs"));

  const hasCra = Boolean(
    pkg?.dependencies?.["react-scripts"] ||
    pkg?.devDependencies?.["react-scripts"] ||
    (typeof pkg?.scripts?.build === "string" && /\breact-scripts\b/.test(pkg.scripts.build)) ||
    (typeof pkg?.scripts?.start === "string" && /\breact-scripts\b/.test(pkg.scripts.start))
  );

  if (hasViteConfig) {
    detectedFramework = "vite";
  } else if (hasNextConfig) {
    detectedFramework = "nextjs";
  } else if (hasCra) {
    detectedFramework = "create-react-app";
  }

  // Effective strategy: explicit request, otherwise auto-select react-vite when
  // the source is genuinely React + Vite and has no existing OneVue adapter.
  let strategy: AdaptationStrategy =
    requestedStrategy || (detectedFramework === "create-react-app" ? "static-standard" : "magicui-vite");

  if (!requestedStrategy) {
    const autoDetection = detectReactVite(sourceDir, pkg);
    const hasOneVueAdapter =
      fs.existsSync(path.join(sourceDir, "src", "onevue", "runtime.js")) ||
      fs.existsSync(path.join(sourceDir, "src", "adapter", "runtime.js")) ||
      fs.existsSync(path.join(sourceDir, "src", "lib", "onevue-profile-adapter.ts"));
    if (autoDetection.detected && !hasOneVueAdapter) {
      strategy = "react-vite";
      findings.push({
        code: "REACT_VITE_AUTO_SELECTED",
        severity: "info",
        message: `Auto-selected the react-vite strategy (${autoDetection.evidence.join(", ")}).`,
      });
    } else if (detectedFramework === "create-react-app") {
      const craDetection = detectCraDevfolio(sourceDir, pkg);
      if (craDetection.detected) {
        strategy = "create-react-app";
        findings.push({
          code: "CRA_DEVFOLIO_AUTO_SELECTED",
          severity: "info",
          message: `Auto-selected the create-react-app strategy (${craDetection.evidence.join(", ")}).`,
        });
      } else {
        strategy = "static-standard";
        findings.push({
          code: "CRA_AUTO_SELECTED",
          severity: "info",
          message: `Auto-selected the static-standard strategy for Create React App: ${craDetection.reasons.join(" ")}`,
        });
      }
    }
  }

  const reactViteDetection = detectReactVite(sourceDir, pkg);

  // Enforce strategy compatibility
  if (strategy === "magicui-vite" && detectedFramework !== "vite") {
    return {
      status: "INCOMPATIBLE",
      templateId,
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{
        code: "UNSUPPORTED_FRAMEWORK",
        severity: "error",
        message: `Template framework '${detectedFramework}' is incompatible with strategy '${strategy}'. Expected Vite project with vite.config.ts/js.`,
      }],
      buildReadiness: {
        ...defaultReadiness,
        framework: detectedFramework,
        expectedArtifactPath: detectedFramework === "create-react-app" ? "build/index.html" : "dist/index.html",
      },
      error: `Unsupported framework: '${detectedFramework}'.`,
    };
  }

  if (strategy === "create-react-app" && detectedFramework !== "create-react-app") {
    return {
      status: "INCOMPATIBLE",
      templateId,
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{
        code: "UNSUPPORTED_FRAMEWORK",
        severity: "error",
        message: `Template framework '${detectedFramework}' is incompatible with strategy '${strategy}'. Expected Create React App project with react-scripts.`,
      }],
      buildReadiness: {
        ...defaultReadiness,
        framework: detectedFramework,
        expectedArtifactPath: detectedFramework === "create-react-app" ? "build/index.html" : "dist/index.html",
      },
      error: `Unsupported framework: '${detectedFramework}'.`,
    };
  }

  if (strategy === "static-standard" && detectedFramework !== "create-react-app" && detectedFramework !== "vite") {
    return {
      status: "INCOMPATIBLE",
      templateId,
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{
        code: "UNSUPPORTED_FRAMEWORK",
        severity: "error",
        message: `Template framework '${detectedFramework}' is incompatible with strategy '${strategy}'.`,
      }],
      buildReadiness: {
        ...defaultReadiness,
        framework: detectedFramework,
      },
      error: `Unsupported framework: '${detectedFramework}'.`,
    };
  }

  if (strategy === "react-vite") {
    if (detectedFramework !== "vite" || !reactViteDetection.detected) {
      return {
        status: "INCOMPATIBLE",
        templateId,
        templateVersion,
        targetDtoVersion,
        provenance,
        sourceDir,
        createdFiles: [],
        modifiedFiles: [],
        findings: [{
          code: "REACT_VITE_NOT_DETECTED",
          severity: "error",
          message: `The react-vite strategy requires a React project that builds with Vite. Evidence: [${
            reactViteDetection.evidence.join(", ") || "none"
          }]. ${reactViteDetection.reasons.join(" ")}`,
        }],
        buildReadiness: {
          ...defaultReadiness,
          framework: detectedFramework,
        },
        error: "React + Vite was not detected reliably for this source.",
      };
    }
  }

  // Detect Package Manager
  let packageManager: "npm" | "pnpm" | "yarn" | "unknown" = "unknown";
  if (fs.existsSync(path.join(sourceDir, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (fs.existsSync(path.join(sourceDir, "package-lock.json"))) packageManager = "npm";
  else if (fs.existsSync(path.join(sourceDir, "yarn.lock"))) packageManager = "yarn";

  // Check build script
  const buildScript = pkg?.scripts?.build;
  if (!buildScript) {
    findings.push({
      code: "MISSING_BUILD_SCRIPT",
      severity: "warning",
      message: "package.json lacks a 'build' script.",
      file: "package.json",
    });
  }

  // 4. Create Isolated Working Copy (Source Immutability Guarantee)
  let workingCopy: { adaptedDir: string; filesCopied: number; cleanup: () => Promise<void> };
  try {
    workingCopy = createIsolatedWorkingCopy(sourceDir);
  } catch (err) {
    return {
      status: "FAILED",
      templateId,
      templateVersion,
      targetDtoVersion,
      provenance,
      sourceDir,
      createdFiles: [],
      modifiedFiles: [],
      findings: [{ code: "COPY_FAILED", severity: "error", message: `Failed to create isolated working copy: ${err instanceof Error ? err.message : String(err)}` }],
      buildReadiness: defaultReadiness,
      error: "Source copying failed.",
    };
  }

  const { adaptedDir, cleanup } = workingCopy;

  let strategyBuildScript: string | undefined;
  let strategySupportedSections: string[] | undefined;
  let strategyChanged = false;

  if (strategy === "react-vite") {
    const outcome = adaptReactViteTemplate({
      adaptedDir,
      templateId,
      templateVersion,
      targetDtoVersion,
      pkg,
    });
    findings.push(...(outcome.findings as ReactViteFinding[]));
    createdFiles.push(...outcome.createdFiles);
    modifiedFiles.push(...outcome.modifiedFiles);
    if (outcome.buildScript) strategyBuildScript = outcome.buildScript;
    strategyChanged = outcome.status === "ADAPTED";

    if (!outcome.ok) {
      await cleanup();
      return {
        status: outcome.status === "FAILED" ? "FAILED" : "INCOMPATIBLE",
        templateId,
        templateVersion,
        targetDtoVersion,
        provenance,
        sourceDir,
        createdFiles: [],
        modifiedFiles: [],
        findings,
        buildReadiness: {
          ...defaultReadiness,
          framework: detectedFramework,
        },
        error: outcome.error || "The react-vite strategy could not adapt this template safely.",
      };
    }
  }

  if (strategy === "create-react-app") {
    const outcome = adaptCraDevfolioTemplate({
      adaptedDir,
      templateId,
      templateVersion,
      pkg,
    });
    findings.push(...(outcome.findings as AdaptationFinding[]));
    createdFiles.push(...outcome.createdFiles);
    modifiedFiles.push(...outcome.modifiedFiles);
    if (outcome.buildScript) strategyBuildScript = outcome.buildScript;
    if (outcome.sections?.mapped?.length) strategySupportedSections = outcome.sections.mapped;
    strategyChanged = outcome.status === "ADAPTED";

    if (!outcome.ok) {
      await cleanup();
      return {
        status: outcome.status === "FAILED" ? "FAILED" : "INCOMPATIBLE",
        templateId,
        templateVersion,
        targetDtoVersion,
        provenance,
        sourceDir,
        createdFiles: [],
        modifiedFiles: [],
        findings,
        buildReadiness: {
          ...defaultReadiness,
          framework: detectedFramework,
          expectedArtifactPath: "build/index.html",
        },
        error: outcome.error || "The create-react-app strategy could not adapt this template safely.",
      };
    }
  }

  // 5. Inspect Manifest & DTO Adapter
  const hasExistingManifest = fs.existsSync(path.join(adaptedDir, "src", "manifest.ts")) ||
    Boolean(pkg?.onevue?.templateId);
  const hasExistingAdapter = fs.existsSync(path.join(adaptedDir, "src", "adapter", "runtime.js")) ||
    fs.existsSync(path.join(adaptedDir, "src", "adapter", "profile-adapter.ts")) ||
    fs.existsSync(path.join(adaptedDir, "src", "onevue", "runtime.js")) ||
    fs.existsSync(path.join(adaptedDir, "src", "lib", "onevue-profile-adapter.ts"));

  let wasAdapted = strategyChanged;

  // If manifest is missing, generate proposed patch in isolated working copy
  if (!hasExistingManifest && strategy !== "create-react-app") {
    const manifestContent = generateTemplateManifestCode(templateId, templateVersion, targetDtoVersion);
    const destManifestPath = path.join(adaptedDir, "src", "manifest.ts");
    fs.mkdirSync(path.dirname(destManifestPath), { recursive: true });
    fs.writeFileSync(destManifestPath, manifestContent, "utf8");
    createdFiles.push({ relativePath: "src/manifest.ts", purpose: "OneVue Template Manifest Declaration" });
    wasAdapted = true;
  }

  // The react-vite and create-react-app strategies generate their own runtime
  // reader; the generic adapter patch would be a second, competing
  // implementation that nothing imports.
  if (!hasExistingAdapter && strategy !== "react-vite" && strategy !== "create-react-app") {
    const adapterCode = `/**
 * OneVue Profile Adapter for ${templateId}
 * Generated automatically by OneVue Adaptation Worker (Phase 5.3)
 */

export const SUPPORTED_DTO_SCHEMA_VERSION = "${targetDtoVersion}";

export function adaptOneVueProfile(dto: any, website?: any) {
  if (!dto || !dto.meta || !dto.profile) {
    throw new Error("Invalid OneVue profile payload: missing root metadata or profile.");
  }
  return {
    name: dto.profile.displayName || "Student",
    initials: dto.profile.initials || "OV",
    headline: dto.profile.headline || "",
    bio: dto.profile.bio || "",
    location: dto.profile.location?.formatted,
    education: Array.isArray(dto.education) ? dto.education : [],
    projects: Array.isArray(dto.projects) ? dto.projects : [],
    skills: Array.isArray(dto.skills) ? dto.skills : [],
    credentials: Array.isArray(dto.credentials) ? dto.credentials : [],
    contact: dto.contact || {},
  };
}
`;
    const destAdapterPath = path.join(adaptedDir, "src", "adapter", "profile-adapter.ts");
    fs.mkdirSync(path.dirname(destAdapterPath), { recursive: true });
    fs.writeFileSync(destAdapterPath, adapterCode, "utf8");
    createdFiles.push({ relativePath: "src/adapter/profile-adapter.ts", purpose: "OneVue PublicProfileDTO_v1 Data Adapter" });
    wasAdapted = true;
  }

  // 6. Build Readiness Assessment
  const effectiveBuildScript =
    strategyBuildScript ||
    buildScript ||
    (detectedFramework === "create-react-app" ? "react-scripts build" : undefined);
  const strategyNotes =
    strategy === "react-vite"
      ? "react-vite strategy applied: Vite base targets the artifact path, the DTO runtime reader is injected, and supported BrowserRouter usage is normalized. Content field mapping is declarative (onevue.adapter.json) and may require a manual import."
      : strategy === "create-react-app"
        ? `create-react-app strategy applied: homepage targets ${releaseAssetBasePath(templateId, templateVersion)} so emitted asset URLs resolve under the delivery path, BrowserRouter is normalized to MemoryRouter with the visitor route, the content module is regenerated from __ONEVUE_DTO__, tracking and unused CDN tags are removed, source maps are disabled and PWA/service-worker output is dropped.`
        : strategy === "static-standard" && detectedFramework === "create-react-app"
          ? "Create React App strategy applied: generated missing manifest and DTO adapter patches. Artifact output targeted to build/."
        : wasAdapted
          ? "Template adapted successfully: generated missing manifest and DTO adapter patches."
          : "Template is natively compatible with OneVue DTO and manifest contracts.";

  const expectedArtifactPath =
    detectedFramework === "create-react-app" || strategy === "create-react-app"
      ? "build/index.html"
      : "dist/index.html";

  const buildReadiness: BuildReadiness = {
    readyToBuild: Boolean(effectiveBuildScript && (hasExistingAdapter || wasAdapted)),
    framework: detectedFramework,
    packageManager,
    buildScript: effectiveBuildScript,
    entrypoint: "index.html",
    expectedArtifactPath,
    supportedSections: strategySupportedSections,
    notes: strategyNotes,
  };

  const finalStatus: AdaptationStatus = wasAdapted ? "ADAPTED" : "COMPATIBLE";

  return {
    status: finalStatus,
    templateId,
    templateVersion,
    targetDtoVersion,
    provenance,
    sourceDir,
    adaptedDir,
    createdFiles,
    modifiedFiles,
    findings,
    buildReadiness,
    cleanup,
  };
}
