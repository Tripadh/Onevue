# OneVue Build Runtime Isolation — Threat Model and Integration Design

Status: **execution remains disabled on this host** (no usable rootless runtime).
The OCI isolation adapter is implemented (`backend/lib/template-build-runtime.ts`),
but a runtime must pass preflight before any build can run. Until then, the only
enforced behavior is configuration validation and fail-closed refusal to execute
untrusted template code.

## Implemented adapter (Phase 5.18)

`OciContainerIsolationRuntimeAdapter` (Docker/Podman) enforces per build:

- fresh writable workspace + `--mount src=<source>,dst=/src,readonly`
- separate `dst=/work` and `dst=/out` mounts
- `--network none`, `--read-only` rootfs, `--cap-drop ALL`,
  `--security-opt no-new-privileges`
- `--memory`/`--memory-swap`, `--cpus`, `--pids-limit`, wall-clock timeout with
  process-group kill, and `rm -f` cleanup after success, failure or abort
- container environment built only from the validated allowlist (+ `CI`,
  `HOME=/work`); host secrets are never passed
- output validation after exit: regular files only, no symlinks, containment,
  byte cap, required `index.html`

Preflight (`preflightRuntime`) verifies the binary (absolute, executable, not
group/world-writable), the daemon, **rootless** mode, the digest-pinned image
present locally, and a harmless smoke container. Any failure yields no adapter.

Two host facts from this environment: the Docker CLI is installed but its daemon
is not running and no rootless socket exists; podman/nsjail are not installed.
`resolveBuildRuntime()` therefore reports `executable: false` and builds remain
disabled. Run the gated real test on a prepared host:
`ONEVUE_TEST_REAL_ISOLATION=1 ... node --test backend/tests/build_runtime_real.test.js`.

## Why a child process is not a boundary

Spawning `npm`, `vite`, or a shell command from the application process does not
provide isolation. It inherits the application's filesystem view, environment,
network namespace, credentials, and process lifetime. It must never be used for
untrusted template builds.

## Threat model for untrusted template code

Assumed attacker capabilities after an approved repository is pinned to a commit:

- Arbitrary code in build scripts, dependencies, lifecycle hooks, plugins, or
  configuration files.
- Attempts to read application source, environment variables, MongoDB/R2/GitHub
  credentials, JWT secrets, SSH keys, cloud metadata, and other tenants' data.
- Attempts to write outside the build workspace, persist across builds, or
  tamper with already published artifacts.
- Outbound network access for data exfiltration or fetching additional payloads.
- CPU, memory, disk, PID, or output-size exhaustion; fork bombs; infinite loops.
- Writing symlinks, hardlinks, device nodes, or traversal paths into the output.
- Racing concurrent builds to overwrite or poison an immutable version.

## Required isolation guarantees

| Requirement | Required guarantee |
| --- | --- |
| Filesystem | Fresh per-build workspace; source mounted read-only; output mounted separately; no host paths; read-only runtime rootfs. |
| Network | Network namespace with `none`; no DNS, no metadata endpoint, no loopback services. |
| CPU / memory / PIDs | Provider-enforced cgroup/runtime limits (see environment contract below). |
| Execution time | Hard wall-clock kill of the whole build process group/sandbox, not just the direct child. |
| Credentials | No inherited application environment; explicit non-sensitive allowlist only. No R2/GitHub/JWT/Mongo values. |
| Termination | Kill process group and sandbox after timeout, abort, or lease loss; wait for exit; remove workspace. |
| Artifact extraction | Copy only the declared output directory; reject symlinks, special files, traversal, secrets, oversized files, and excess file counts; recompute SHA-256. |
| Concurrency | Unique workspace and publish staging per build; immutable version publish is atomic and never overwrites. |
| Audit | Record runtime identity, image digest, limits, exit status, duration, and artifact digest. |

## Current environment contract

The executor validates these variables when
`ENABLE_ISOLATED_BUILD_EXECUTION=true`:

```text
ONEVUE_BUILD_ISOLATION_RUNTIME=docker|podman|nsjail|firecracker
ONEVUE_BUILD_ISOLATION_BINARY=<absolute runtime binary path>
ONEVUE_BUILD_ISOLATION_IMAGE=<image or rootfs>@sha256:<64 hex>
ONEVUE_BUILD_NETWORK_MODE=none
ONEVUE_BUILD_READ_ONLY_ROOTFS=true
ONEVUE_BUILD_TIMEOUT_MS=<1000..1800000>
ONEVUE_BUILD_MEMORY_MB=<64..8192>
ONEVUE_BUILD_CPU_LIMIT=<0.1..8>
ONEVUE_BUILD_PIDS_LIMIT=<16..4096>
ONEVUE_BUILD_ENV_ALLOWLIST=<optional non-sensitive names>
ONEVUE_BUILD_MAX_OUTPUT_BYTES=<optional 1 MiB..1 GiB>
ONEVUE_BUILD_DEPENDENCY_CACHE_DIR=<optional absolute, existing dir>
                              # mounted read-only at /deps for offline installs
```

When a lockfile is present, the sandbox installs dependencies offline before the
build command (`npm ci --offline --ignore-scripts --cache /deps`, or the pnpm/yarn
equivalents). There is no networked fallback; a missing cache or missing package
fails the build with an actionable error. Lifecycle scripts are disabled because
the security policy does not permit dependency code execution during install.

When a lockfile is present, the sandbox installs dependencies offline before the
build (`npm ci --offline --ignore-scripts --cache /deps`, or the pnpm/yarn
equivalents). There is no networked fallback; a missing cache or missing package
fails with an actionable error. Dependency lifecycle scripts are disabled because
the security policy does not permit dependency code execution during install.

Validation rejects mutable image tags, host networking, writable rootfs,
non-absolute binaries, unsupported runtimes, credential-like environment names,
and missing or out-of-range limits. Diagnostics never include environment values.

Even when every value is valid, `IsolatedSandboxBuildExecutor` still fails closed
because no verified runtime adapter is integrated. The admin
`GET /api/admin/templates/build` endpoint exposes only enabled/configured/
executable state, reason, errors, and warnings.

## Integration design

1. Implement `BuildIsolationRuntimeAdapter.executeBuild(...)` for exactly one
   runtime (recommended: rootless Podman or Docker with a digest-pinned image
   and a minimal hardening profile, or a dedicated microVM runner).
2. The adapter must:
   - verify the runtime binary ownership/mode and image digest before use;
   - create a unique read-only source mount and separate writable output mount;
   - apply network `none`, read-only rootfs, non-root UID/GID, no-new-privileges,
     dropped capabilities, cgroup CPU/memory/PID limits, and a hard timeout;
   - pass only the validated allowlist, never `process.env`;
   - kill the full sandbox/process group on timeout, abort, or lease loss;
   - copy and validate only the declared output directory.
3. Inject the adapter into `IsolatedSandboxBuildExecutor` only after the
   restrictions have dedicated integration tests that prove filesystem, network,
   credential, resource, and termination behavior.
4. Keep the application database and storage credentials out of the runtime
   environment. Publish artifacts only after the sandbox exits and the existing
   `verifyAndPackageArtifact` checks pass.
5. Add a production preflight that verifies the binary, digest, and a smoke-test
   sandbox before the admin build route reports `executable: true`.

## Prerequisites before enabling execution

- A supported runtime installed and pinned on every build host.
- A digest-pinned minimal build image maintained by OneVue.
- Host/kernel support for namespaces, cgroups v2, and process-group kill.
- Dedicated unprivileged build user and no access to application mounts.
- Egress controls at the host/firewall layer in addition to runtime `none`.
- Monitoring for timeouts, OOM kills, PID exhaustion, and sandbox escapes.
- Integration tests that attempt filesystem escape, network access, credential
  read, fork bomb, OOM, timeout, and concurrent-build races.

Until those prerequisites are met, `ENABLE_ISOLATED_BUILD_EXECUTION` must remain
unset or `false`, and template builds must continue to fail closed.
