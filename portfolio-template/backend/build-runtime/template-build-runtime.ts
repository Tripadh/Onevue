/**
 * =========================================================================
 * OneVue Phase 5.18 — Isolated Build Runtime (OCI: Docker / Podman)
 * =========================================================================
 *
 * Implements the existing `BuildIsolationRuntimeAdapter` contract with a real
 * container runtime. Nothing here executes template code on the host: the build
 * command runs inside a container that is network-isolated, uses a read-only
 * rootfs, mounts the pinned source read-only, writes only to dedicated mounts,
 * and is subject to CPU/memory/PID limits and a hard wall-clock timeout.
 *
 * Fail-closed rules:
 * - `preflightRuntime()` verifies the runtime binary, daemon, rootless mode,
 *   digest-pinned image and a harmless smoke container. If any check fails, no
 *   adapter is produced and builds remain disabled.
 * - The runtime must be rootless. Rootful daemons are refused.
 *
 * The container executes a FIXED, audited shell script; only the repository's
 * declared build command is interpolated, and it runs inside the sandbox.
 *
 * Verified image requirements (documented, not assumed): a POSIX `sh`, `cp`,
 * and the toolchain needed by the template (typically Node.js + npm/pnpm). The
 * build must be able to resolve dependencies offline (vendored `node_modules`
 * or an image-provided package cache), because networking is disabled.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  getBuildIsolationStatus,
  type BuildIsolationConfig,
  type BuildIsolationRuntimeAdapter,
} from "./template-build-isolation";
import {
  IsolatedSandboxBuildExecutor,
  type BuildExecutor,
} from "./template-build";

const PREFLIGHT_TTL_MS = 60_000;
const PREFLIGHT_TIMEOUT_MS = 20_000;
const SMOKE_TIMEOUT_MS = 30_000;
const DEFAULT_BUILD_SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_COMMAND_LENGTH = 2_000;
const MAX_LOG_BYTES = 512 * 1024;
const FIXED_ARTIFACT_DIRS = ["dist", "build", "out", ".output/public", "public"];

export interface ProcessOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export interface RuntimePreflightResult {
  ok: boolean;
  errors: string[];
  runtime?: string;
  version?: string;
  rootless?: boolean;
  imageDigestVerified?: boolean;
  smokeTestPassed?: boolean;
  checkedAt: string;
}

export interface BuildRuntimeResolution {
  status: ReturnType<typeof getBuildIsolationStatus>;
  adapter?: BuildIsolationRuntimeAdapter;
  preflight?: RuntimePreflightResult;
}

/* =========================================================================
   Process execution
   ========================================================================= */

function runProcess(
  command: string,
  args: string[],
  options: {
    env?: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
    detached?: boolean;
    maxOutputBytes?: number;
  }
): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env || {},
      stdio: ["ignore", "pipe", "pipe"],
      detached: options.detached === true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const cap = options.maxOutputBytes ?? MAX_LOG_BYTES;

    const append = (current: string, chunk: Buffer) => {
      if (current.length >= cap) return current;
      return (current + chunk.toString("utf8")).slice(0, cap);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut, aborted });
    };

    const terminate = () => {
      try {
        if (options.detached && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, Math.max(1, options.timeoutMs));

    const onAbort = () => {
      aborted = true;
      terminate();
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (error) => {
      stderr = append(stderr, Buffer.from(String(error)));
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Client-side environment for the runtime CLI only (not the container). */
function cliEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const clientEnv: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "DOCKER_HOST", "XDG_RUNTIME_DIR", "TMPDIR"]) {
    const value = env[key];
    if (typeof value === "string" && value) clientEnv[key] = value;
  }
  if (!clientEnv.PATH) clientEnv.PATH = "/usr/local/bin:/usr/bin:/bin";
  return clientEnv;
}

/* =========================================================================
   Binary and preflight verification
   ========================================================================= */

function verifyRuntimeBinary(binary: string): string[] {
  const errors: string[] = [];
  if (!binary || !path.isAbsolute(binary)) {
    return ["The isolation runtime binary must be an absolute path."];
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(binary);
  } catch {
    return [`The isolation runtime binary '${binary}' does not exist.`];
  }
  if (!stats.isFile()) errors.push(`'${binary}' is not a regular file.`);
  try {
    fs.accessSync(binary, fs.constants.X_OK);
  } catch {
    errors.push(`'${binary}' is not executable.`);
  }
  if (stats.mode & 0o022) {
    errors.push(`'${binary}' is group- or world-writable and cannot be trusted.`);
  }
  return errors;
}

function expectedDigest(imageDigest: string): string | null {
  const match = imageDigest.match(/@sha256:([a-f0-9]{64})$/);
  return match ? match[1] : null;
}

async function runtimeInfo(
  config: BuildIsolationConfig,
  env: Record<string, string | undefined>
): Promise<{ version?: string; rootless?: boolean; errors: string[] }> {
  const clientEnv = cliEnvironment(env);
  const errors: string[] = [];

  const versionResult = await runProcess(config.runtimeBinary, ["--version"], {
    env: clientEnv,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });
  if (versionResult.code !== 0) {
    errors.push("The isolation runtime did not report a version.");
    return { errors };
  }
  const version = versionResult.stdout.trim().split("\n")[0];

  if (config.runtime === "docker") {
    const info = await runProcess(
      config.runtimeBinary,
      ["info", "--format", "{{.ServerVersion}}|{{json .SecurityOptions}}"],
      { env: clientEnv, timeoutMs: PREFLIGHT_TIMEOUT_MS }
    );
    if (info.code !== 0) {
      errors.push(
        `The Docker daemon is not reachable: ${info.stderr.trim().slice(0, 300) || "daemon unavailable"}.`
      );
      return { version, errors };
    }
    const [serverVersion, securityOptions] = info.stdout.trim().split("|");
    const rootless = String(securityOptions || "").includes("name=rootless");
    if (!serverVersion) errors.push("The Docker daemon did not report a server version.");
    return { version, rootless, errors };
  }

  if (config.runtime === "podman") {
    const info = await runProcess(
      config.runtimeBinary,
      ["info", "--format", "{{.Host.Security.Rootless}}"],
      { env: clientEnv, timeoutMs: PREFLIGHT_TIMEOUT_MS }
    );
    if (info.code !== 0) {
      errors.push(`Podman is not usable: ${info.stderr.trim().slice(0, 300) || "unavailable"}.`);
      return { version, errors };
    }
    return { version, rootless: info.stdout.trim() === "true", errors };
  }

  errors.push(`Runtime '${config.runtime}' is not supported by this adapter.`);
  return { version, errors };
}

async function verifyImageDigest(
  config: BuildIsolationConfig,
  env: Record<string, string | undefined>
): Promise<{ ok: boolean; error?: string }> {
  const digest = expectedDigest(config.imageDigest);
  if (!digest) return { ok: false, error: "The configured image is not digest-pinned." };

  const result = await runProcess(
    config.runtimeBinary,
    ["image", "inspect", "--format", "{{json .RepoDigests}}", config.imageDigest],
    { env: cliEnvironment(env), timeoutMs: PREFLIGHT_TIMEOUT_MS }
  );
  if (result.code !== 0) {
    return {
      ok: false,
      error: "The pinned build image is not present locally (pull and pin it before enabling builds).",
    };
  }
  let digests: string[] = [];
  try {
    digests = JSON.parse(result.stdout.trim() || "[]");
  } catch {
    return { ok: false, error: "The runtime returned an unreadable image digest list." };
  }
  const matched = digests.some((entry) => String(entry).endsWith(`@sha256:${digest}`));
  return matched
    ? { ok: true }
    : { ok: false, error: "The locally available image does not match the pinned digest." };
}

async function smokeTest(
  config: BuildIsolationConfig,
  env: Record<string, string | undefined>
): Promise<{ ok: boolean; error?: string }> {
  const name = `onevue-build-smoke-${crypto.randomUUID()}`;
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(Math.min(config.pidsLimit, 64)),
    "--memory",
    String(Math.min(config.memoryBytes, 256 * 1024 * 1024)),
    "--cpus",
    String(Math.min(config.cpus, 1)),
    "--entrypoint",
    "/bin/sh",
    config.imageDigest,
    "-c",
    "exit 0",
  ];
  const result = await runProcess(config.runtimeBinary, args, {
    env: cliEnvironment(env),
    timeoutMs: SMOKE_TIMEOUT_MS,
    detached: true,
  });
  if (result.timedOut) return { ok: false, error: "The isolation smoke test timed out." };
  if (result.code !== 0) {
    return {
      ok: false,
      error: `The isolation smoke test failed: ${result.stderr.trim().slice(0, 300) || "unknown error"}.`,
    };
  }
  return { ok: true };
}

const preflightCache = new Map<string, RuntimePreflightResult>();

function preflightCacheKey(config: BuildIsolationConfig): string {
  return [config.runtime, config.runtimeBinary, config.imageDigest, config.pidsLimit].join("|");
}

/**
 * Verifies that the configured runtime can actually isolate a build. Results
 * are cached briefly; failures are cached too, so a broken host fails fast.
 */
export async function preflightRuntime(
  config: BuildIsolationConfig,
  env: Record<string, string | undefined> = process.env,
  options: { force?: boolean } = {}
): Promise<RuntimePreflightResult> {
  const key = preflightCacheKey(config);
  const cached = preflightCache.get(key);
  if (!options.force && cached && Date.now() - Date.parse(cached.checkedAt) < PREFLIGHT_TTL_MS) {
    return cached;
  }

  const errors = verifyRuntimeBinary(config.runtimeBinary);
  const result: RuntimePreflightResult = {
    ok: false,
    errors,
    runtime: config.runtime,
    checkedAt: new Date().toISOString(),
  };

  if (errors.length === 0) {
    const info = await runtimeInfo(config, env);
    result.version = info.version;
    result.rootless = info.rootless;
    errors.push(...info.errors);

    if (errors.length === 0 && info.rootless !== true) {
      errors.push("The isolation runtime is not rootless. Rootful daemons are refused.");
    }

    if (errors.length === 0) {
      const image = await verifyImageDigest(config, env);
      result.imageDigestVerified = image.ok;
      if (!image.ok && image.error) errors.push(image.error);
    }

    if (errors.length === 0) {
      const smoke = await smokeTest(config, env);
      result.smokeTestPassed = smoke.ok;
      if (!smoke.ok && smoke.error) errors.push(smoke.error);
    }
  }

  result.errors = errors;
  result.ok = errors.length === 0;
  preflightCache.set(key, result);
  return result;
}

/* =========================================================================
   OCI adapter
   ========================================================================= */

export interface OciAdapterOptions {
  config: BuildIsolationConfig;
  env?: Record<string, string | undefined>;
  /** Preflight override (tests). Production always runs preflightRuntime. */
  preflight?: () => Promise<RuntimePreflightResult>;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Offline dependency installation. Runs only inside the sandbox, never on the
 * host, and never falls back to a networked install. Dependency lifecycle
 * scripts are disabled (`--ignore-scripts`) because the security policy does
 * not permit dependency code execution during install.
 */
const OFFLINE_INSTALL_SCRIPT = [
  'if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then',
  '  if [ ! -d /deps ]; then echo "ONeVUE_DEPENDENCY_CACHE_MISSING: a package lock is present but no dependency cache was mounted (ONEVUE_BUILD_DEPENDENCY_CACHE_DIR)." >&2; exit 6; fi',
  "  npm ci --offline --ignore-scripts --no-audit --no-fund --cache /deps",
  "elif [ -f pnpm-lock.yaml ]; then",
  '  if [ ! -d /deps ]; then echo "ONeVUE_DEPENDENCY_CACHE_MISSING: a pnpm lock is present but no dependency cache was mounted." >&2; exit 6; fi',
  "  pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir /deps",
  "elif [ -f yarn.lock ]; then",
  '  if [ ! -d /deps ]; then echo "ONeVUE_DEPENDENCY_CACHE_MISSING: a yarn lock is present but no dependency cache was mounted." >&2; exit 6; fi',
  "  yarn install --offline --frozen-lockfile --ignore-scripts --cache-folder /deps",
  "fi",
].join("\n");

function fixedBuildScript(buildCommand: string): string {
  const artifactChecks = FIXED_ARTIFACT_DIRS.map(
    (dir) => `if [ -z "$ART" ] && [ -f "${dir}/index.html" ]; then ART="${dir}"; fi`
  ).join("\n");

  return [
    "set -eu",
    "rm -rf /work/* /work/.[!.]* 2>/dev/null || true",
    "cp -a /src/. /work/",
    "cd /work",
    OFFLINE_INSTALL_SCRIPT,
    // Run through npm when the project declares a build script so node_modules/.bin
    // is on PATH (e.g. "vite build"). Otherwise execute the provided command.
    'if node -e \'process.exit(require("./package.json").scripts.build ? 0 : 1)\' 2>/dev/null; then',
    "  npm run build",
    "else",
    `  ${buildCommand}`,
    "fi",
    'ART=""',
    artifactChecks,
    'if [ -z "$ART" ] && [ -f /work/index.html ]; then ART="."; fi',
    'if [ -z "$ART" ]; then echo "ONeVUE_BUILD_NO_ARTIFACT" >&2; exit 3; fi',
    'cp -a "$ART"/. /out/',
    'if [ ! -f /out/index.html ]; then echo "ONeVUE_BUILD_NO_ENTRYPOINT" >&2; exit 4; fi',
  ].join("\n");
}

function validateBuildCommand(command: string | undefined): string | null {
  const value = String(command || "").trim();
  if (!value) return null;
  if (value.length > MAX_COMMAND_LENGTH) return null;
  if (value.includes("\0")) return null;
  return value;
}

function walkOutput(root: string, limits: { maxBytes: number }): string | undefined {
  let total = 0;
  const visit = (current: string): string | undefined => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full).replace(/\\/g, "/");
      const stats = fs.lstatSync(full);
      if (stats.isSymbolicLink()) return `artifact output contains a symbolic link: '${relative}'`;
      if (stats.isDirectory()) {
        const nested = visit(full);
        if (nested) return nested;
      } else if (!stats.isFile()) {
        return `artifact output contains a non-regular file: '${relative}'`;
      } else {
        total += stats.size;
        if (total > limits.maxBytes) return "artifact output exceeds the configured byte limit";
      }
      const resolved = path.resolve(full);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        return `artifact output escapes its directory: '${relative}'`;
      }
    }
    return undefined;
  };
  return visit(root);
}

export class OciContainerIsolationRuntimeAdapter implements BuildIsolationRuntimeAdapter {
  private config: BuildIsolationConfig;
  private env: Record<string, string | undefined>;
  private preflight: () => Promise<RuntimePreflightResult>;

  constructor(options: OciAdapterOptions) {
    this.config = options.config;
    this.env = options.env || process.env;
    this.preflight = options.preflight || (() => preflightRuntime(this.config, this.env));
  }

  private imageReference(): string {
    return this.config.imageDigest;
  }

  private containerEnvironmentArgs(): string[] {
    const args: string[] = [];
    for (const name of this.config.envAllowlist) {
      const value = this.env[name];
      if (typeof value === "string" && value) args.push("-e", `${name}=${value}`);
    }
    // Fixed, non-sensitive build environment.
    args.push("-e", "CI=true", "-e", "HOME=/work");
    return args;
  }

  /** The container command. Only the declared build script is interpolated. */
  buildContainerArgs(options: {
    name: string;
    sourceDir: string;
    workspaceDir: string;
    outputDir: string;
    buildScript: string;
  }): string[] {
    const { config } = this;
    return [
      "run",
      "--rm",
      "--name",
      options.name,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      String(config.pidsLimit),
      "--memory",
      String(config.memoryBytes),
      "--memory-swap",
      String(config.memoryBytes),
      "--cpus",
      String(config.cpus),
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=67108864",
      "--mount",
      `type=bind,src=${options.sourceDir},dst=/src,readonly`,
      "--mount",
      `type=bind,src=${options.workspaceDir},dst=/work`,
      "--mount",
      `type=bind,src=${options.outputDir},dst=/out`,
      ...(config.dependencyCacheDir
        ? ["--mount", `type=bind,src=${config.dependencyCacheDir},dst=/deps,readonly`]
        : []),
      "--workdir",
      "/src",
      ...this.containerEnvironmentArgs(),
      "--entrypoint",
      "/bin/sh",
      this.imageReference(),
      "-c",
      fixedBuildScript(options.buildScript),
    ];
  }

  async executeBuild(invocation: {
    sourceDir: string;
    outputDir: string;
    buildScript?: string;
    timeoutMs: number;
    signal?: AbortSignal;
    config: BuildIsolationConfig;
  }): Promise<{ success: boolean; outputDir?: string; error?: string }> {
    const { config } = this;

    let sourceDir: string;
    try {
      sourceDir = fs.realpathSync(invocation.sourceDir);
      if (!fs.statSync(sourceDir).isDirectory()) {
        return { success: false, error: "The build source is not a directory." };
      }
    } catch {
      return { success: false, error: "The build source directory is missing." };
    }

    const outputDir = path.resolve(invocation.outputDir);
    if (isInside(sourceDir, outputDir) || isInside(outputDir, sourceDir) || sourceDir === outputDir) {
      return { success: false, error: "Source and output directories must be separate." };
    }

    const buildCommand = validateBuildCommand(invocation.buildScript);
    if (!buildCommand) {
      return {
        success: false,
        error: "The template does not declare a valid build command (package.json scripts.build).",
      };
    }

    const preflight = await this.preflight();
    if (!preflight.ok) {
      return {
        success: false,
        error: `Isolation runtime preflight failed: ${preflight.errors.join(" ")}`,
      };
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-build-work-"));
    fs.chmodSync(workspaceDir, 0o777);
    for (const entry of fs.readdirSync(outputDir)) {
      fs.rmSync(path.join(outputDir, entry), { recursive: true, force: true });
    }

    const name = `onevue-build-${crypto.randomUUID()}`;
    const timeoutMs = Math.min(
      Math.max(1, invocation.timeoutMs || config.timeoutMs),
      config.timeoutMs
    );
    const args = this.buildContainerArgs({
      name,
      sourceDir,
      workspaceDir,
      outputDir,
      buildScript: buildCommand,
    });

    try {
      const outcome = await runProcess(config.runtimeBinary, args, {
        env: cliEnvironment(this.env),
        timeoutMs,
        signal: invocation.signal,
        detached: true,
      });

      if (outcome.timedOut) {
        return { success: false, error: `Isolated build timed out after ${timeoutMs}ms.` };
      }
      if (outcome.aborted) {
        return { success: false, error: "Isolated build was cancelled." };
      }
      if (outcome.code !== 0) {
        const detail = (outcome.stderr || outcome.stdout).trim().slice(0, 800);
        const dependencyFailure = /ONeVUE_DEPENDENCY_CACHE_MISSING/.test(detail)
          ? "Dependency installation is unavailable: the template has a lockfile but no offline dependency cache is configured."
          : /ENOTCACHED|is not in the cache|offline mode|request to .* failed/i.test(detail)
            ? "Offline dependency installation failed: required packages are missing from the cache. Populate ONEVUE_BUILD_DEPENDENCY_CACHE_DIR from the exact lockfile on a networked host (npm cache add / npm ci), then retry."
            : null;
        return {
          success: false,
          error: dependencyFailure
            ? `${dependencyFailure} Sandbox output: ${detail}`
            : `Isolated build exited with code ${outcome.code}: ${detail}`,
        };
      }

      // Output validation happens on the host, after the sandbox exits.
      const outputError = walkOutput(outputDir, { maxBytes: config.maxOutputBytes });
      if (outputError) {
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(outputDir, { recursive: true });
        return { success: false, error: `Artifact output rejected: ${outputError}.` };
      }
      if (!fs.existsSync(path.join(outputDir, "index.html"))) {
        return { success: false, error: "Artifact output is missing its index.html entrypoint." };
      }

      return { success: true, outputDir };
    } catch (error) {
      return {
        success: false,
        error: `Isolated build runtime error: ${error instanceof Error ? error.message : String(error)}.`,
      };
    } finally {
      // Remove the container if it survived (timeout/abort), then the workspace.
      await runProcess(config.runtimeBinary, ["rm", "-f", name], {
        env: cliEnvironment(this.env),
        timeoutMs: 15_000,
      });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  }
}

/* =========================================================================
   Configuration resolution (used by routes / startup validation)
   ========================================================================= */

/**
 * Validates the isolation configuration and, only if the runtime passes
 * preflight, returns a ready adapter. Otherwise builds stay disabled.
 */
export async function resolveBuildRuntime(
  env: Record<string, string | undefined> = process.env
): Promise<BuildRuntimeResolution> {
  const baseStatus = getBuildIsolationStatus(env, { runtimeAdapterIntegrated: true });
  if (!baseStatus.enabled || !baseStatus.configured || !baseStatus.config) {
    return { status: getBuildIsolationStatus(env) };
  }

  const preflight = await preflightRuntime(baseStatus.config, env);
  if (!preflight.ok) {
    return {
      status: {
        ...baseStatus,
        executable: false,
        reason: `Isolation runtime preflight failed. Execution remains disabled. ${preflight.errors.join(" ")}`,
      },
      preflight,
    };
  }

  return {
    status: baseStatus,
    adapter: new OciContainerIsolationRuntimeAdapter({
      config: baseStatus.config,
      env,
      preflight: async () => preflight,
    }),
    preflight,
  };
}

/**
 * Returns an executor only when the configured runtime passes preflight.
 * Callers must treat `undefined` as "builds unavailable" and fail closed.
 */
export async function createConfiguredBuildExecutor(
  env: Record<string, string | undefined> = process.env
): Promise<{ executor?: BuildExecutor; resolution: BuildRuntimeResolution }> {
  const resolution = await resolveBuildRuntime(env);
  if (!resolution.adapter) {
    return { resolution };
  }
  return {
    executor: new IsolatedSandboxBuildExecutor({
      env,
      runtimeAdapter: resolution.adapter,
    }),
    resolution,
  };
}

/** Startup/health-check helper: validates configuration and preflight. */
export async function validateBuildRuntimeAtStartup(
  env: Record<string, string | undefined> = process.env
): Promise<{
  enabled: boolean;
  configured: boolean;
  executable: boolean;
  reason: string;
  errors: string[];
  preflight?: RuntimePreflightResult;
}> {
  const resolution = await resolveBuildRuntime(env);
  return {
    enabled: resolution.status.enabled,
    configured: resolution.status.configured,
    executable: Boolean(resolution.adapter),
    reason: resolution.status.reason,
    errors: [...resolution.status.errors, ...(resolution.preflight?.errors || [])],
    preflight: resolution.preflight,
  };
}

/** Test hook: clears the cached preflight result. */
export function clearRuntimePreflightCache(): void {
  preflightCache.clear();
}
