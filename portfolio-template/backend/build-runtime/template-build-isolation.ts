/**
 * =========================================================================
 * OneVue Phase 5.11.3 — Build Runtime Isolation Configuration & Diagnostics
 * =========================================================================
 *
 * This module deliberately does NOT execute untrusted template code. It only
 * validates the configuration that a future, genuinely isolated runtime must
 * satisfy, and exposes fail-closed diagnostics to the build executor.
 *
 * A child process, a shell command, or an application process is NOT an
 * isolation boundary. Until a verified runtime adapter is integrated, the
 * build executor must remain disabled.
 *
 * Required configuration (all fail closed when missing or invalid):
 *   ENABLE_ISOLATED_BUILD_EXECUTION=true
 *   ONEVUE_BUILD_ISOLATION_RUNTIME=docker|podman|nsjail|firecracker
 *   ONEVUE_BUILD_ISOLATION_BINARY=<absolute path to the runtime binary>
 *   ONEVUE_BUILD_ISOLATION_IMAGE=<image or rootfs>@sha256:<64 hex digest>
 *   ONEVUE_BUILD_NETWORK_MODE=none
 *   ONEVUE_BUILD_READ_ONLY_ROOTFS=true
 *   ONEVUE_BUILD_TIMEOUT_MS=<1000..1800000>
 *   ONEVUE_BUILD_MEMORY_MB=<64..8192>
 *   ONEVUE_BUILD_CPU_LIMIT=<0.1..8>
 *   ONEVUE_BUILD_PIDS_LIMIT=<16..4096>
 *   ONEVUE_BUILD_ENV_ALLOWLIST=<optional comma-separated, non-sensitive names>
 *   ONEVUE_BUILD_MAX_OUTPUT_BYTES=<optional 1 MiB..1 GiB, default 256 MiB>
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const SUPPORTED_ISOLATION_RUNTIMES = ["docker", "podman", "nsjail", "firecracker"] as const;
export type IsolationRuntime = (typeof SUPPORTED_ISOLATION_RUNTIMES)[number];

export interface BuildIsolationConfig {
  enabled: true;
  runtime: IsolationRuntime;
  runtimeBinary: string;
  imageDigest: string;
  networkMode: "none";
  readOnlyRootfs: true;
  envAllowlist: string[];
  timeoutMs: number;
  memoryBytes: number;
  cpus: number;
  pidsLimit: number;
  maxOutputBytes: number;
  /** Absolute, pre-populated package cache mounted read-only for offline installs. */
  dependencyCacheDir?: string;
}

export interface BuildIsolationDiagnostics {
  enabled: boolean;
  configured: boolean;
  executable: boolean;
  config?: BuildIsolationConfig;
  errors: string[];
  warnings: string[];
  reason: string;
}

export interface BuildIsolationRuntimeAdapter {
  executeBuild(invocation: {
    sourceDir: string;
    outputDir: string;
    buildScript?: string;
    timeoutMs: number;
    signal?: AbortSignal;
    config: BuildIsolationConfig;
  }): Promise<{ success: boolean; outputDir?: string; error?: string }>;
}

const ENV = {
  enabled: "ENABLE_ISOLATED_BUILD_EXECUTION",
  runtime: "ONEVUE_BUILD_ISOLATION_RUNTIME",
  binary: "ONEVUE_BUILD_ISOLATION_BINARY",
  image: "ONEVUE_BUILD_ISOLATION_IMAGE",
  network: "ONEVUE_BUILD_NETWORK_MODE",
  readOnlyRootfs: "ONEVUE_BUILD_READ_ONLY_ROOTFS",
  timeout: "ONEVUE_BUILD_TIMEOUT_MS",
  memory: "ONEVUE_BUILD_MEMORY_MB",
  cpus: "ONEVUE_BUILD_CPU_LIMIT",
  pids: "ONEVUE_BUILD_PIDS_LIMIT",
  envAllowlist: "ONEVUE_BUILD_ENV_ALLOWLIST",
  maxOutput: "ONEVUE_BUILD_MAX_OUTPUT_BYTES",
  dependencyCache: "ONEVUE_BUILD_DEPENDENCY_CACHE_DIR",
} as const;

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_MEMORY_MB = 64;
const MAX_MEMORY_MB = 8 * 1024;
const MIN_CPUS = 0.1;
const MAX_CPUS = 8;
const MIN_PIDS = 16;
const MAX_PIDS = 4_096;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const MIN_MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
const MAX_MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;
const IMAGE_DIGEST_REGEX = /^[^\s@]+@sha256:[a-f0-9]{64}$/;
const ENV_NAME_REGEX = /^[A-Z_][A-Z0-9_]*$/;
const SENSITIVE_ENV_NAME = /(SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH|DATABASE|MONGO|R2_|GITHUB|JWT|AWS_|PRIVATE)/i;
const RESERVED_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "HOSTNAME",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
]);

function readString(env: Record<string, string | undefined>, key: string): string {
  return typeof env[key] === "string" ? env[key]!.trim() : "";
}

function parseStrictInteger(value: string): number | undefined {
  if (!/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseStrictNumber(value: string): number | undefined {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseEnvAllowlist(value: string, errors: string[]): string[] {
  if (!value) return [];
  const names = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const allowlist: string[] = [];
  for (const name of names) {
    if (!ENV_NAME_REGEX.test(name)) {
      errors.push(`Environment allowlist entry '${name}' is not a valid variable name.`);
      continue;
    }
    if (RESERVED_ENV_NAMES.has(name) || SENSITIVE_ENV_NAME.test(name)) {
      errors.push(`Environment allowlist entry '${name}' is reserved or may expose credentials.`);
      continue;
    }
    if (!allowlist.includes(name)) allowlist.push(name);
  }
  return allowlist;
}

export function readBuildIsolationConfig(env: Record<string, string | undefined> = process.env): {
  enabled: boolean;
  config?: BuildIsolationConfig;
  errors: string[];
  warnings: string[];
} {
  const enabled = readString(env, ENV.enabled) === "true";
  if (!enabled) {
    return {
      enabled: false,
      errors: [],
      warnings: ["Isolated build execution is disabled; no runtime configuration was evaluated."],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const runtimeValue = readString(env, ENV.runtime).toLowerCase();
  if (!SUPPORTED_ISOLATION_RUNTIMES.includes(runtimeValue as IsolationRuntime)) {
    errors.push(
      `${ENV.runtime} must be one of: ${SUPPORTED_ISOLATION_RUNTIMES.join(", ")}.`
    );
  }
  const runtime = runtimeValue as IsolationRuntime;

  const runtimeBinary = readString(env, ENV.binary);
  if (!runtimeBinary) {
    errors.push(`${ENV.binary} must point at an absolute isolation runtime binary.`);
  } else if (!path.isAbsolute(runtimeBinary) || runtimeBinary.includes("\0")) {
    errors.push(`${ENV.binary} must be an absolute filesystem path.`);
  } else {
    warnings.push(`${ENV.binary} existence, ownership, and executable mode must be re-verified by the runtime adapter.`);
  }

  const imageDigest = readString(env, ENV.image);
  if (!imageDigest) {
    errors.push(`${ENV.image} must pin an immutable image or rootfs digest.`);
  } else if (!IMAGE_DIGEST_REGEX.test(imageDigest)) {
    errors.push(`${ENV.image} must include an immutable @sha256:<64 hex> digest; mutable tags are not accepted.`);
  }

  const networkMode = readString(env, ENV.network);
  if (networkMode !== "none") {
    errors.push(`${ENV.network} must be exactly 'none'; host or bridged networking is not permitted.`);
  }

  const readOnlyRootfsValue = readString(env, ENV.readOnlyRootfs).toLowerCase();
  if (readOnlyRootfsValue !== "true") {
    errors.push(`${ENV.readOnlyRootfs} must be exactly 'true'; a writable runtime rootfs is not permitted.`);
  }

  const timeoutMs = parseStrictInteger(readString(env, ENV.timeout));
  if (timeoutMs === undefined || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    errors.push(`${ENV.timeout} must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds.`);
  }

  const memoryMb = parseStrictInteger(readString(env, ENV.memory));
  if (memoryMb === undefined || memoryMb < MIN_MEMORY_MB || memoryMb > MAX_MEMORY_MB) {
    errors.push(`${ENV.memory} must be an integer between ${MIN_MEMORY_MB} and ${MAX_MEMORY_MB} MiB.`);
  }

  const cpus = parseStrictNumber(readString(env, ENV.cpus));
  if (cpus === undefined || cpus < MIN_CPUS || cpus > MAX_CPUS) {
    errors.push(`${ENV.cpus} must be a number between ${MIN_CPUS} and ${MAX_CPUS}.`);
  }

  const pidsLimit = parseStrictInteger(readString(env, ENV.pids));
  if (pidsLimit === undefined || pidsLimit < MIN_PIDS || pidsLimit > MAX_PIDS) {
    errors.push(`${ENV.pids} must be an integer between ${MIN_PIDS} and ${MAX_PIDS}.`);
  }

  const envAllowlist = parseEnvAllowlist(readString(env, ENV.envAllowlist), errors);
  if (!envAllowlist.length) {
    warnings.push("The build environment allowlist is empty; the runtime must not inherit host or application environment variables.");
  }

  const maxOutputRaw = readString(env, ENV.maxOutput);
  const maxOutputBytes = maxOutputRaw ? parseStrictInteger(maxOutputRaw) : DEFAULT_MAX_OUTPUT_BYTES;
  if (maxOutputBytes === undefined || maxOutputBytes < MIN_MAX_OUTPUT_BYTES || maxOutputBytes > MAX_MAX_OUTPUT_BYTES) {
    errors.push(`${ENV.maxOutput} must be an integer between ${MIN_MAX_OUTPUT_BYTES} and ${MAX_MAX_OUTPUT_BYTES} bytes.`);
  }

  // Optional offline dependency cache. When configured it must be an absolute,
  // existing directory; it is mounted read-only and never inherited from env.
  const dependencyCacheRaw = readString(env, ENV.dependencyCache);
  let dependencyCacheDir: string | undefined;
  if (dependencyCacheRaw) {
    if (!path.isAbsolute(dependencyCacheRaw) || dependencyCacheRaw.includes("\0")) {
      errors.push(`${ENV.dependencyCache} must be an absolute directory path.`);
    } else {
      try {
        const stats = fs.statSync(dependencyCacheRaw);
        if (!stats.isDirectory()) {
          errors.push(`${ENV.dependencyCache} must point at a directory (found a file).`);
        } else {
          dependencyCacheDir = path.resolve(dependencyCacheRaw);
        }
      } catch {
        errors.push(`${ENV.dependencyCache} does not exist or is not accessible.`);
      }
    }
  } else {
    warnings.push(
      "No offline dependency cache is configured. Templates with a lockfile will fail closed instead of installing packages."
    );
  }

  if (errors.length > 0) return { enabled, errors, warnings };

  return {
    enabled,
    config: {
      enabled: true,
      runtime,
      runtimeBinary,
      imageDigest,
      networkMode: "none",
      readOnlyRootfs: true,
      envAllowlist,
      timeoutMs: timeoutMs!,
      memoryBytes: memoryMb! * 1024 * 1024,
      cpus: cpus!,
      pidsLimit: pidsLimit!,
      maxOutputBytes: maxOutputBytes!,
      dependencyCacheDir,
    },
    errors,
    warnings,
  };
}

export function getBuildIsolationStatus(
  env: Record<string, string | undefined> = process.env,
  options: { runtimeAdapterIntegrated?: boolean } = {}
): BuildIsolationDiagnostics {
  const read = readBuildIsolationConfig(env);
  const adapterIntegrated = options.runtimeAdapterIntegrated === true;

  if (!read.enabled) {
    return {
      enabled: false,
      configured: false,
      executable: false,
      errors: read.errors,
      warnings: read.warnings,
      reason:
        "Isolated build execution is disabled by server policy (ENABLE_ISOLATED_BUILD_EXECUTION != true). Host execution is strictly prohibited.",
    };
  }

  if (read.errors.length > 0) {
    return {
      enabled: true,
      configured: false,
      executable: false,
      errors: read.errors,
      warnings: read.warnings,
      reason: "Isolated build execution configuration is invalid. Execution remains disabled.",
    };
  }

  if (!adapterIntegrated) {
    return {
      enabled: true,
      configured: true,
      executable: false,
      config: read.config,
      errors: [],
      warnings: read.warnings,
      reason:
        "Isolated build runtime configuration is valid, but no verified isolation runtime adapter is integrated. Execution remains disabled.",
    };
  }

  return {
    enabled: true,
    configured: true,
    executable: true,
    config: read.config,
    errors: [],
    warnings: read.warnings,
    reason: "A verified isolation runtime adapter is integrated and configuration validation passed.",
  };
}
