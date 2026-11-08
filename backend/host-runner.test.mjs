import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT, RunnerError, buildChildEnv, checkRuntimeDir, parseEnvFile, run, sanitizePath, selectEnvFileKeys, validateJob,
} from './host-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMIT = 'f869083ff3edb61eb417581197947bdb0ce408e2';
const JOB = ['--repo', 'crypticani/portfolio', '--commit', COMMIT, '--framework', 'cra', '--output', 'build/index.html'];

function sandbox({ podmanScript = '#!/bin/sh\necho "podman version 5.7.0"\n', adapterBody, allow = [], adapterTimeoutMs = 20000, envFile = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hr-'));
  const podman = join(dir, 'podman');
  writeFileSync(podman, podmanScript);
  chmodSync(podman, 0o755);
  const marker = join(dir, 'adapter-ran.json');
  const adapter = join(dir, 'adapter.mjs');
  writeFileSync(adapter, adapterBody ?? `import {writeFileSync} from 'node:fs';
writeFileSync(process.argv[2], JSON.stringify({env: process.env, argv: process.argv.slice(3)}));`);
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({
    podmanPath: podman, preflightTimeoutMs: 20000, adapterTimeoutMs, envFileAllow: allow,
    adapter: { command: process.execPath, args: [adapter, marker, '{commit}', '{output}'], cwd: dir },
  }));
  const envPath = join(dir, '.env.local');
  writeFileSync(envPath, envFile);
  const runtime = join(dir, 'run'); // fake XDG_RUNTIME_DIR owned by us
  writeFileSync(join(dir, '.keep'), '');
  return { dir, marker, config, envPath, runtime };
}

function hostEnv(s, extra = {}) {
  return { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: s.dir, XDG_RUNTIME_DIR: s.dir, TMPDIR: s.dir, ...extra };
}
const args = (s) => ['--config', s.config, '--env-file', s.envPath, ...JOB];
const quiet = () => {};

test('production config pins /usr/bin/podman and the 20 s preflight timeout', () => {
  const cfg = JSON.parse(readFileSync(join(HERE, 'host-runner.config.json'), 'utf8'));
  assert.equal(cfg.podmanPath, '/usr/bin/podman');
  assert.equal(cfg.preflightTimeoutMs, 20000);
});

test('job validation rejects bad repo, commit, framework and output path', () => {
  const ok = { repo: 'crypticani/portfolio', commit: COMMIT, framework: 'cra', output: 'build/index.html' };
  assert.deepEqual(validateJob(ok), ok);
  for (const bad of [
    { repo: 'crypticani/portfolio; rm -rf /' }, { repo: 'a/..' }, { commit: COMMIT.slice(0, 7) },
    { commit: COMMIT.toUpperCase() }, { framework: 'next' }, { output: '../etc/passwd' },
    { output: '/abs/index.html' }, { output: 'build/$(id)' },
  ]) assert.throws(() => validateJob({ ...ok, ...bad }), RunnerError);
});

test('env file parsing: comments, export, quotes', () => {
  assert.deepEqual(parseEnvFile('# c\nexport A=1\nB="two words"\nC=\'x\'\n\nbad line\n'), { A: '1', B: 'two words', C: 'x' });
});

test('reserved keys cannot be allowlisted from the env file', () => {
  for (const k of ['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'TMPDIR', 'DOCKER_HOST', 'CONTAINERS_CONF', 'LD_PRELOAD', 'NODE_OPTIONS', 'PODMAN_IGNORE_CGROUPSV1_WARNING']) {
    assert.throws(() => selectEnvFileKeys({}, [k]), RunnerError, k);
  }
});

test('PATH must be absolute-only', () => {
  assert.equal(sanitizePath('/usr/bin:/bin'), '/usr/bin:/bin');
  for (const bad of ['', 'bin', '/usr/bin::/bin', '/usr/../bin', '.:/usr/bin']) assert.throws(() => sanitizePath(bad), RunnerError, bad);
});

test('missing required host variables fail closed', () => {
  const full = { PATH: '/usr/bin', HOME: '/home/u', XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/tmp' };
  for (const k of Object.keys(full)) {
    const { [k]: _, ...rest } = full;
    assert.throws(() => buildChildEnv(rest), RunnerError, k);
  }
});

test('EROFS on the runtime dir or libpod gives a clear "run on host" error (exit 78), read-only check only', () => {
  const erofs = () => { const e = new Error('ro'); e.code = 'EROFS'; throw e; };
  assert.throws(() => checkRuntimeDir('/run/user/1000', { access: erofs, exists: () => true }), (e) => e.exitCode === EXIT.ENVIRONMENT && /restricted sandbox/.test(e.message));
  const onlyLibpod = (p) => { if (p.endsWith('libpod')) erofs(); };
  assert.throws(() => checkRuntimeDir('/run/user/1000', { access: onlyLibpod, exists: () => true, stat: () => ({ uid: 1000 }), uid: 1000 }), /libpod/);
});

test('runtime dir owned by another user is rejected', () => {
  assert.throws(() => checkRuntimeDir('/run/user/1000', { access: () => {}, exists: () => false, stat: () => ({ uid: 0 }), uid: 1000 }), /not owned/);
});

test('environment propagation: adapter gets exactly base vars + allowlisted .env.local keys, nothing else', async () => {
  const s = sandbox({ allow: ['ONEVUE_BUILD_MODE'], envFile: 'ONEVUE_BUILD_MODE=offline\nSECRET_TOKEN=abc\nPATH=/evil\n' });
  const { exitCode, summary } = await run({
    argv: args(s), log: quiet,
    hostEnv: hostEnv(s, { AWS_SECRET_ACCESS_KEY: 'x', NODE_OPTIONS: '--inspect', DOCKER_HOST: 'tcp://evil:2375' }),
  });
  assert.equal(exitCode, EXIT.OK, JSON.stringify(summary));
  const { env, argv } = JSON.parse(readFileSync(s.marker, 'utf8'));
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'ONEVUE_BUILD_MODE', 'PATH', 'TMPDIR', 'XDG_RUNTIME_DIR']);
  assert.equal(env.PATH, '/usr/local/bin:/usr/bin:/bin'); // .env.local cannot override PATH
  assert.equal(env.ONEVUE_BUILD_MODE, 'offline');
  assert.deepEqual(argv, [COMMIT, 'build/index.html']);
  assert.deepEqual(summary.env.droppedFromEnvFile, ['PATH', 'SECRET_TOKEN']);
});

test('podman preflight failure (the reported error) aborts before the adapter runs', async () => {
  const s = sandbox({ podmanScript: '#!/bin/sh\necho "Failed to obtain podman configuration: set sticky bit on: chmod /run/user/1000/libpod: read-only file system" >&2\nexit 1\n' });
  const { exitCode, summary } = await run({ argv: args(s), hostEnv: hostEnv(s), log: quiet });
  assert.equal(exitCode, EXIT.PREFLIGHT_FAILED);
  assert.equal(summary.stage, 'preflight');
  assert.match(summary.error, /sticky bit/);
  assert.equal(existsSync(s.marker), false);
});

test('--preflight-only checks podman and does not run the adapter', async () => {
  const s = sandbox();
  const { exitCode, summary } = await run({ argv: [...args(s), '--preflight-only'], hostEnv: hostEnv(s), log: quiet });
  assert.equal(exitCode, EXIT.OK);
  assert.equal(summary.preflight.version, '5.7.0');
  assert.equal(existsSync(s.marker), false);
});

test('the preflight itself receives the explicit env', async () => {
  const dump = '#!/bin/sh\necho "podman version 5.7.0"\nenv > "$HOME/podman-env.txt"\n';
  const s = sandbox({ podmanScript: dump });
  await run({ argv: [...args(s), '--preflight-only'], hostEnv: hostEnv(s, { LEAK: '1' }), log: quiet });
  const seen = readFileSync(join(s.dir, 'podman-env.txt'), 'utf8');
  assert.match(seen, /^XDG_RUNTIME_DIR=/m);
  assert.doesNotMatch(seen, /^LEAK=/m);
});

test('adapter failure exit code is surfaced, not swallowed', async () => {
  const s = sandbox({ adapterBody: 'process.exit(3)' });
  const { exitCode, summary } = await run({ argv: args(s), hostEnv: hostEnv(s), log: quiet });
  assert.equal(exitCode, EXIT.ADAPTER_FAILED);
  assert.equal(summary.adapter.exitCode, 3);
});

test('adapter timeout kills the process', async () => {
  const s = sandbox({ adapterBody: 'setInterval(()=>{},1000)', adapterTimeoutMs: 300 });
  const { exitCode, summary } = await run({ argv: args(s), hostEnv: hostEnv(s), log: quiet });
  assert.equal(exitCode, EXIT.ADAPTER_FAILED);
  assert.equal(summary.adapter.timedOut, true);
});

test('unconfigured adapter placeholder refuses to run', async () => {
  const s = sandbox();
  const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
  cfg.adapter.command = 'CONFIGURE_ME';
  writeFileSync(s.config, JSON.stringify(cfg));
  const { exitCode, summary } = await run({ argv: args(s), hostEnv: hostEnv(s), log: quiet });
  assert.equal(exitCode, EXIT.USAGE);
  assert.match(summary.error, /not configured/);
});

// ---------- integration tests: runner-to-adapter execution path ----------

const FAKE_PODMAN_SCRIPT_OK = `#!/bin/sh
case "$1" in
  --version)
    echo "podman version 5.7.0"
    exit 0
    ;;
  info)
    echo "true"
    exit 0
    ;;
  image)
    echo '["docker.io/library/node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c"]'
    exit 0
    ;;
  run|rm)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;

const FAKE_PODMAN_SCRIPT_FAIL_PREFLIGHT2 = `#!/bin/sh
case "$1" in
  --version)
    echo "podman version 5.7.0"
    exit 0
    ;;
  info)
    echo "Failed to obtain podman configuration: set sticky bit on: chmod /run/user/1000/libpod: read-only file system" >&2
    exit 1
    ;;
  image|run|rm)
    exit 1
    ;;
  *)
    exit 1
    ;;
esac
`;

test('integration: runner-to-adapter exercises full path with fake podman, passing both preflights', async () => {
  const allow = [
    'ENABLE_ISOLATED_BUILD_EXECUTION',
    'ONEVUE_BUILD_ISOLATION_RUNTIME',
    'ONEVUE_BUILD_ISOLATION_BINARY',
    'ONEVUE_BUILD_ISOLATION_IMAGE',
    'ONEVUE_BUILD_NETWORK_MODE',
    'ONEVUE_BUILD_READ_ONLY_ROOTFS',
    'ONEVUE_BUILD_TIMEOUT_MS',
    'ONEVUE_BUILD_MEMORY_MB',
    'ONEVUE_BUILD_CPU_LIMIT',
    'ONEVUE_BUILD_PIDS_LIMIT',
    'ONEVUE_BUILD_ENV_ALLOWLIST',
    'ONEVUE_BUILD_MAX_OUTPUT_BYTES',
    'ONEVUE_BUILD_DEPENDENCY_CACHE_DIR',
    'ONEVUE_TEMPLATE_STORAGE_ROOT',
    'ONEVUE_SOURCE_SNAPSHOT_ROOT',
    'TSC_COMPILE_ON_ERROR',
  ];
  const s = sandbox({
    podmanScript: FAKE_PODMAN_SCRIPT_OK,
    allow,
  });

  writeFileSync(s.envPath, [
    'ENABLE_ISOLATED_BUILD_EXECUTION=true',
    'ONEVUE_BUILD_ISOLATION_RUNTIME=podman',
    `ONEVUE_BUILD_ISOLATION_BINARY=${join(s.dir, 'podman')}`,
    'ONEVUE_BUILD_ISOLATION_IMAGE=docker.io/library/node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c',
    'ONEVUE_BUILD_NETWORK_MODE=none',
    'ONEVUE_BUILD_READ_ONLY_ROOTFS=true',
    'ONEVUE_BUILD_TIMEOUT_MS=300000',
    'ONEVUE_BUILD_MEMORY_MB=2048',
    'ONEVUE_BUILD_CPU_LIMIT=2',
    'ONEVUE_BUILD_PIDS_LIMIT=512',
    'ONEVUE_BUILD_ENV_ALLOWLIST=NODE_ENV,TSC_COMPILE_ON_ERROR',
    'ONEVUE_BUILD_MAX_OUTPUT_BYTES=268435456',
    `ONEVUE_BUILD_DEPENDENCY_CACHE_DIR=${s.dir}`,
    `ONEVUE_TEMPLATE_STORAGE_ROOT=${join(s.dir, 'storage')}`,
    `ONEVUE_SOURCE_SNAPSHOT_ROOT=${join(s.dir, 'snapshots')}`,
    'TSC_COMPILE_ON_ERROR=true',
  ].join('\n'));

  // Point adapter at the real run-adapter-build.mjs with --preflight-only
  const realAdapterScript = join(HERE, 'scripts/run-adapter-build.mjs');
  const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
  cfg.adapter = {
    command: process.execPath,
    args: [realAdapterScript, '--preflight-only', '--repo', '{repo}', '--commit', '{commit}', '--framework', '{framework}', '--output', '{output}'],
    cwd: HERE,
  };
  writeFileSync(s.config, JSON.stringify(cfg, null, 2));

  const { exitCode, summary } = await run({
    argv: args(s),
    hostEnv: hostEnv(s),
    log: quiet,
  });

  assert.equal(exitCode, EXIT.OK, JSON.stringify(summary));
  assert.equal(summary.stage, 'done');
  assert.equal(summary.preflight.ok, true);
  assert.equal(summary.adapter.exitCode, 0);
  assert.equal(summary.ok, true);
});

test('integration: runner-to-adapter fails closed when second podman preflight fails (chmod libpod EROFS)', async () => {
  const allow = [
    'ENABLE_ISOLATED_BUILD_EXECUTION',
    'ONEVUE_BUILD_ISOLATION_RUNTIME',
    'ONEVUE_BUILD_ISOLATION_BINARY',
    'ONEVUE_BUILD_ISOLATION_IMAGE',
    'ONEVUE_BUILD_NETWORK_MODE',
    'ONEVUE_BUILD_READ_ONLY_ROOTFS',
    'ONEVUE_BUILD_TIMEOUT_MS',
    'ONEVUE_BUILD_MEMORY_MB',
    'ONEVUE_BUILD_CPU_LIMIT',
    'ONEVUE_BUILD_PIDS_LIMIT',
    'ONEVUE_BUILD_ENV_ALLOWLIST',
    'ONEVUE_BUILD_MAX_OUTPUT_BYTES',
    'ONEVUE_BUILD_DEPENDENCY_CACHE_DIR',
    'ONEVUE_TEMPLATE_STORAGE_ROOT',
    'ONEVUE_SOURCE_SNAPSHOT_ROOT',
    'TSC_COMPILE_ON_ERROR',
  ];
  const s = sandbox({
    podmanScript: FAKE_PODMAN_SCRIPT_FAIL_PREFLIGHT2,
    allow,
  });

  writeFileSync(s.envPath, [
    'ENABLE_ISOLATED_BUILD_EXECUTION=true',
    'ONEVUE_BUILD_ISOLATION_RUNTIME=podman',
    `ONEVUE_BUILD_ISOLATION_BINARY=${join(s.dir, 'podman')}`,
    'ONEVUE_BUILD_ISOLATION_IMAGE=docker.io/library/node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c',
    'ONEVUE_BUILD_NETWORK_MODE=none',
    'ONEVUE_BUILD_READ_ONLY_ROOTFS=true',
    'ONEVUE_BUILD_TIMEOUT_MS=300000',
    'ONEVUE_BUILD_MEMORY_MB=2048',
    'ONEVUE_BUILD_CPU_LIMIT=2',
    'ONEVUE_BUILD_PIDS_LIMIT=512',
    'ONEVUE_BUILD_ENV_ALLOWLIST=NODE_ENV,TSC_COMPILE_ON_ERROR',
    'ONEVUE_BUILD_MAX_OUTPUT_BYTES=268435456',
    `ONEVUE_BUILD_DEPENDENCY_CACHE_DIR=${s.dir}`,
    `ONEVUE_TEMPLATE_STORAGE_ROOT=${join(s.dir, 'storage')}`,
    `ONEVUE_SOURCE_SNAPSHOT_ROOT=${join(s.dir, 'snapshots')}`,
    'TSC_COMPILE_ON_ERROR=true',
  ].join('\n'));

  // Preflight 1 (host runner) passes --version; Preflight 2 (adapter) fails on podman info
  const realAdapterScript = join(HERE, 'scripts/run-adapter-build.mjs');
  const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
  cfg.adapter = {
    command: process.execPath,
    args: [realAdapterScript, '--preflight-only', '--repo', '{repo}', '--commit', '{commit}', '--framework', '{framework}', '--output', '{output}'],
    cwd: HERE,
  };
  writeFileSync(s.config, JSON.stringify(cfg, null, 2));

  const { exitCode, summary } = await run({
    argv: args(s),
    hostEnv: hostEnv(s),
    log: quiet,
  });

  assert.equal(exitCode, EXIT.ADAPTER_FAILED, JSON.stringify(summary));
  assert.equal(summary.preflight.ok, true, 'first preflight succeeded');
  assert.equal(summary.adapter.exitCode, 1, 'adapter preflight failed closed');
  assert.equal(summary.ok, false);
});

test('integration: real host podman preflight verification (distinguished from fake)', async () => {
  if (!existsSync('/usr/bin/podman')) {
    return; // Skip when not on an Ubuntu host with podman
  }
  const realConfig = join(HERE, 'host-runner.config.json');
  const realEnv = join(HERE, '.env.local');
  if (!existsSync(realConfig) || !existsSync(realEnv)) return;

  const { exitCode, summary } = await run({
    argv: ['--config', realConfig, '--env-file', realEnv, '--preflight-only', ...JOB],
    hostEnv: {
      ...process.env,
      TMPDIR: process.env.TMPDIR || '/tmp',
    },
    log: quiet,
  });

  assert.equal(exitCode, EXIT.OK, JSON.stringify(summary));
  assert.equal(summary.preflight.ok, true);
  assert.match(summary.preflight.version, /^5\.\d+\.\d+/);
});
