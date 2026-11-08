#!/usr/bin/env node
/**
 * OneVue host runner.
 *
 * Run this from a NORMAL Ubuntu host terminal (not the restricted agent sandbox).
 * It does not replace the production adapter. It:
 *   1. validates the job (repo / commit / framework / output) with strict patterns,
 *   2. builds the child environment EXPLICITLY (PATH, HOME, XDG_RUNTIME_DIR, TMPDIR
 *      from the host + only allowlisted keys from .env.local),
 *   3. checks, read-only, that the Podman runtime dir is usable (never chmod/mkdir),
 *   4. runs `podman --version` preflight with the same env (20 s timeout),
 *   5. only then execs the existing adapter command from the config, no shell.
 *
 * It never passes --privileged, never touches container flags, and never writes
 * to /run/user/<uid>. Container isolation stays entirely inside the adapter.
 */
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({
  OK: 0,
  ADAPTER_FAILED: 1,
  USAGE: 64,
  PREFLIGHT_FAILED: 69,
  ENVIRONMENT: 78,
});

export class RunnerError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

const BASE_KEYS = ['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'TMPDIR'];
const RESERVED_EXACT = new Set([...BASE_KEYS, 'SHELL', 'IFS', 'BASH_ENV', 'ENV']);
const RESERVED_PREFIXES = ['XDG_', 'DOCKER_', 'PODMAN_', 'CONTAINER', 'BUILDAH_', 'LD_', 'NODE_'];
const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

// ---------- env handling ----------

export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const q = value[0];
    if (value.length >= 2 && (q === '"' || q === "'") && value.at(-1) === q) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

export function selectEnvFileKeys(parsed, allow) {
  for (const key of allow) {
    if (!KEY_RE.test(key)) throw new RunnerError(EXIT.USAGE, `invalid allowlist key "${key}"`);
    if (RESERVED_EXACT.has(key) || RESERVED_PREFIXES.some((p) => key.startsWith(p))) {
      throw new RunnerError(EXIT.USAGE, `env key "${key}" is reserved and cannot come from the env file`);
    }
  }
  const selected = {};
  const dropped = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (allow.includes(k)) selected[k] = v;
    else dropped.push(k); // names only, never values
  }
  return { selected, dropped };
}

export function sanitizePath(value) {
  const parts = value.split(':');
  if (parts.some((p) => !isAbsolute(p) || p.split('/').includes('..'))) {
    throw new RunnerError(EXIT.ENVIRONMENT, 'PATH must contain only absolute directories (no empty, relative or ".." entries)');
  }
  return parts.join(':');
}

export function buildChildEnv(hostEnv, { envFileText = '', allow = [] } = {}) {
  const base = {};
  for (const k of BASE_KEYS) {
    if (!hostEnv[k]) throw new RunnerError(EXIT.ENVIRONMENT, `${k} is not set in the host environment`);
    base[k] = hostEnv[k];
  }
  base.PATH = sanitizePath(base.PATH);
  for (const k of ['HOME', 'XDG_RUNTIME_DIR', 'TMPDIR']) {
    if (!isAbsolute(base[k])) throw new RunnerError(EXIT.ENVIRONMENT, `${k} must be an absolute path`);
  }
  const { selected, dropped } = selectEnvFileKeys(parseEnvFile(envFileText), allow);
  return { env: { ...selected, ...base }, dropped };
}

// ---------- read-only runtime-dir check (never mkdir/chmod) ----------

export function checkRuntimeDir(
  dir,
  { access = accessSync, stat = statSync, exists = existsSync, uid = process.getuid?.() } = {},
) {
  const targets = [dir];
  if (exists(join(dir, 'libpod'))) targets.push(join(dir, 'libpod')); // the path Podman chmods
  for (const t of targets) {
    try {
      access(t, constants.W_OK | constants.X_OK);
    } catch (e) {
      const why =
        e.code === 'EROFS'
          ? 'is on a read-only filesystem: this process is inside the restricted sandbox. Run the host runner from a normal Ubuntu terminal.'
          : `is not writable (${e.code ?? e.message})`;
      throw new RunnerError(EXIT.ENVIRONMENT, `${t} ${why}`);
    }
  }
  if (uid !== undefined && stat(dir).uid !== uid) {
    throw new RunnerError(EXIT.ENVIRONMENT, `${dir} is not owned by the current user`);
  }
}

// ---------- job validation ----------

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const OUTPUT_RE = /^[A-Za-z0-9_./-]+$/;
const FRAMEWORKS = new Set(['cra']);

export function validateJob({ repo, commit, framework, output }) {
  const bad = (m) => new RunnerError(EXIT.USAGE, m);
  if (!repo || !REPO_RE.test(repo) || repo.split('/').some((s) => /^\.+$/.test(s))) throw bad('invalid --repo (expected owner/name)');
  if (!commit || !COMMIT_RE.test(commit)) throw bad('invalid --commit (expected full 40-char lowercase SHA)');
  if (!framework || !FRAMEWORKS.has(framework)) throw bad(`invalid --framework (allowed: ${[...FRAMEWORKS].join(', ')})`);
  if (!output || !OUTPUT_RE.test(output) || output.startsWith('/') || output.split('/').includes('..')) {
    throw bad('invalid --output (must be a relative path without "..")');
  }
  return { repo, commit, framework, output };
}

// ---------- podman preflight + adapter ----------

export function preflightPodman({ podmanPath, env, timeoutMs, spawnSyncImpl = spawnSync }) {
  const r = spawnSyncImpl(podmanPath, ['--version'], { env, timeout: timeoutMs, encoding: 'utf8', shell: false });
  const m = /^podman version (\d+\.\d+\.\d+\S*)/m.exec(r.stdout ?? '');
  return {
    ok: r.status === 0 && Boolean(m),
    version: m?.[1] ?? null,
    exitCode: r.status,
    error: r.error?.code ?? null,
    stderr: (r.stderr ?? '').trim().slice(0, 500),
  };
}

export function runAdapter({ command, args, env, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    // adapter stdout/stderr -> our stderr, so our stdout stays one clean JSON summary
    const child = spawn(command, args, { env, cwd, shell: false, stdio: ['ignore', 2, 2] });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exitCode: null, signal: null, timedOut, spawnError: e.code ?? e.message });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, timedOut });
    });
  });
}

// ---------- orchestration ----------

function loadConfig(path) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new RunnerError(EXIT.USAGE, `cannot read config ${path}: ${e.message}`);
  }
  const ok =
    isAbsolute(cfg.podmanPath ?? '') &&
    Number.isInteger(cfg.preflightTimeoutMs) && cfg.preflightTimeoutMs > 0 &&
    Number.isInteger(cfg.adapterTimeoutMs) && cfg.adapterTimeoutMs > 0 &&
    Array.isArray(cfg.envFileAllow) &&
    typeof cfg.adapter?.command === 'string' &&
    Array.isArray(cfg.adapter?.args) && cfg.adapter.args.every((a) => typeof a === 'string');
  if (!ok) throw new RunnerError(EXIT.USAGE, 'config is malformed (see host-runner.config.json)');
  return cfg;
}

export async function run({ argv, hostEnv = process.env, deps = {}, log = (m) => process.stderr.write(`${m}\n`) }) {
  const summary = { ok: false, stage: 'init' };
  try {
    let values;
    try {
      ({ values } = parseArgs({
        args: argv,
        strict: true,
        options: {
          config: { type: 'string', default: 'host-runner.config.json' },
          'env-file': { type: 'string', default: '.env.local' },
          repo: { type: 'string' },
          commit: { type: 'string' },
          framework: { type: 'string' },
          output: { type: 'string' },
          'preflight-only': { type: 'boolean', default: false },
        },
      }));
    } catch (e) {
      throw new RunnerError(EXIT.USAGE, e.message);
    }

    summary.stage = 'config';
    const cfg = loadConfig(values.config);
    const job = validateJob(values);
    summary.job = job;

    summary.stage = 'environment';
    const envFileText = existsSync(values['env-file']) ? readFileSync(values['env-file'], 'utf8') : '';
    if (!envFileText) log(`note: ${values['env-file']} not found or empty; no build settings loaded`);
    const { env, dropped } = buildChildEnv(hostEnv, { envFileText, allow: cfg.envFileAllow });
    summary.env = { passed: Object.keys(env).sort(), droppedFromEnvFile: dropped.sort() };

    summary.stage = 'runtime-dir';
    checkRuntimeDir(env.XDG_RUNTIME_DIR, deps.runtimeDir);

    summary.stage = 'preflight';
    const pf = preflightPodman({ podmanPath: cfg.podmanPath, env, timeoutMs: cfg.preflightTimeoutMs, spawnSyncImpl: deps.spawnSync });
    summary.preflight = pf;
    if (!pf.ok) {
      throw new RunnerError(EXIT.PREFLIGHT_FAILED, `podman preflight failed (exit ${pf.exitCode}${pf.error ? `, ${pf.error}` : ''}): ${pf.stderr}`);
    }
    if (values['preflight-only']) {
      summary.ok = true;
      summary.stage = 'done';
      return { exitCode: EXIT.OK, summary };
    }

    summary.stage = 'adapter';
    if (cfg.adapter.command === 'CONFIGURE_ME') {
      throw new RunnerError(EXIT.USAGE, 'adapter.command is not configured; point it at the existing production adapter entrypoint');
    }
    const args = cfg.adapter.args.map((a) => a.replace(/\{(repo|commit|framework|output)\}/g, (_, k) => job[k]));
    const res = await runAdapter({
      command: cfg.adapter.command,
      args,
      env,
      cwd: cfg.adapter.cwd ?? process.cwd(),
      timeoutMs: deps.adapterTimeoutMs ?? cfg.adapterTimeoutMs,
    });
    summary.adapter = res;
    summary.ok = res.exitCode === 0 && !res.timedOut;
    summary.stage = 'done';
    return { exitCode: summary.ok ? EXIT.OK : EXIT.ADAPTER_FAILED, summary };
  } catch (e) {
    if (!(e instanceof RunnerError)) throw e;
    summary.error = e.message;
    log(`host-runner: ${e.message}`);
    return { exitCode: e.exitCode, summary };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ argv: process.argv.slice(2) }).then(({ exitCode, summary }) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(exitCode);
  });
}
