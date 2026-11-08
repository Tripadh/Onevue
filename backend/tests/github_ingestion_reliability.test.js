/**
 * =========================================================================
 * OneVue — Archive Download Reliability Test Suite (Phase 4)
 * =========================================================================
 *
 * The ingestion pipeline used to hardcode a 30 second archive download
 * timeout, which silently overrode `ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS` and
 * made large repositories impossible to ingest. The retry loop that was
 * supposed to help could not help either: every attempt shared one deadline,
 * so a retry inherited whatever was left of an already exhausted budget.
 *
 * Verifies:
 * 1. The environment variable is honoured, and no 30 second default remains.
 * 2. `timeoutMs` is a TOTAL budget; each attempt gets its own bounded slice.
 * 3. A timed-out attempt is retried while the total budget still allows it.
 * 4. The total budget is never exceeded, whatever the attempt count.
 * 5. `maxAttempts` is forwarded explicitly by the ingestion pipeline.
 * 6. The archive size, extracted size, file count and trusted host limits
 *    are all still enforced.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

let ts;
try {
  ts = require("typescript");
} catch {
  ts = require(path.resolve(__dirname, "../node_modules/typescript"));
}

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

const {
  downloadSourceArchive,
  ingestGitHubTemplateSource,
  inspectSourceArchive,
} = require("../lib/github-ingestion.ts");

const TRUSTED_URL = "https://codeload.github.com/owner/repo/legacy.tar.gz/abc";

function archiveResponse(body = "archive") {
  const response = new Response(body, { status: 200, headers: { "Content-Type": "application/gzip" } });
  Object.defineProperty(response, "url", { value: TRUSTED_URL });
  return response;
}

/** A response whose body never ends, so only the attempt deadline can stop it. */
function hangingResponse(signal) {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => {
          try {
            controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
          } catch {
            // The stream may already be closed.
          }
        });
      },
    }),
    { status: 200 }
  );
  Object.defineProperty(response, "url", { value: TRUSTED_URL });
  return response;
}

/** A minimal POSIX ustar archive with one oversized entry. */
function createMockTarball(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(entry.path, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "utf8");
    header.write("0001000\0", 108, 8, "utf8");
    header.write("0001000\0", 116, 8, "utf8");
    const contentBuf = Buffer.from(entry.content || "", "utf8");
    header.write(contentBuf.length.toString(8).padStart(11, "0") + " ", 124, 12, "utf8");
    header.write("14000000000\0", 136, 12, "utf8");
    header.write(entry.type || "0", 156, 1, "utf8");
    header.write("ustar\0", 257, 6, "utf8");
    header.write("00", 263, 2, "utf8");
    header.write("        ", 148, 8, "utf8");
    let checksum = 0;
    for (let i = 0; i < 512; i += 1) checksum += header[i];
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
    blocks.push(header);
    if (contentBuf.length > 0) {
      const paddedLen = Math.ceil(contentBuf.length / 512) * 512;
      const dataBlock = Buffer.alloc(paddedLen, 0);
      contentBuf.copy(dataBlock);
      blocks.push(dataBlock);
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

describe("Phase 4 — archive download reliability", () => {
  const originalTimeout = process.env.ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS;

  beforeEach(() => {
    delete process.env.ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS;
  });

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS;
    else process.env.ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS = originalTimeout;
  });

  it("honours ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS instead of a hardcoded 30 seconds", async () => {
    process.env.ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS = "250";

    const result = await downloadSourceArchive({
      owner: "owner",
      repo: "repo",
      sha: "a".repeat(40),
      maxAttempts: 1,
      fetchImpl: async (_url, init) => hangingResponse(init.signal),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /timed out after 250ms/);
    assert.doesNotMatch(result.error, /30000ms/);
  });

  it("reports the configured total budget and the per-attempt slice in the timeout message", async () => {
    const result = await downloadSourceArchive({
      owner: "owner",
      repo: "repo",
      sha: "a".repeat(40),
      timeoutMs: 600,
      maxAttempts: 3,
      fetchImpl: async (_url, init) => hangingResponse(init.signal),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /timed out after 600ms/);
    assert.match(result.error, /3 attempt\(s\)/);
    // 600ms total across 3 attempts is a 200ms slice per attempt.
    assert.match(result.error, /200ms per attempt/);
  });

  it("gives every attempt its own bounded slice and retries a timed-out attempt", async () => {
    const startedAt = Date.now();
    const abortTimes = [];
    let calls = 0;

    const result = await downloadSourceArchive({
      owner: "owner",
      repo: "repo",
      sha: "a".repeat(40),
      timeoutMs: 600,
      maxAttempts: 3,
      fetchImpl: async (_url, init) => {
        calls += 1;
        init.signal.addEventListener("abort", () => abortTimes.push(Date.now()));
        return hangingResponse(init.signal);
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /timed out/);
    assert.ok(calls >= 2, `a timed-out attempt must be retried (calls: ${calls})`);
    assert.ok(abortTimes.length >= 1);
    // The first attempt is bounded by its own 200ms slice, not by the 600ms
    // total budget: one slow attempt must not starve the retries.
    assert.ok(
      abortTimes[0] - startedAt < 450,
      `the first attempt must not consume the whole total budget (aborted after ${abortTimes[0] - startedAt}ms)`
    );
  });

  it("never exceeds the total budget, whatever the attempt count", async () => {
    const startedAt = Date.now();
    const result = await downloadSourceArchive({
      owner: "owner",
      repo: "repo",
      sha: "a".repeat(40),
      timeoutMs: 300,
      maxAttempts: 4,
      fetchImpl: async (_url, init) => hangingResponse(init.signal),
    });
    const elapsed = Date.now() - startedAt;

    assert.equal(result.success, false);
    assert.ok(elapsed < 900, `the total budget must be authoritative (took ${elapsed}ms)`);
  });

  it("forwards maxAttempts explicitly through the ingestion pipeline", async () => {
    let archiveCalls = 0;
    const fetchImpl = async (url) => {
      const target = String(url);
      if (target.includes("/commits/")) {
        return new Response(JSON.stringify({ sha: "b".repeat(40) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      archiveCalls += 1;
      // A retryable status: the downloader must try again, exactly as many
      // times as the pipeline was told to.
      const response = new Response("temporarily unavailable", { status: 503 });
      Object.defineProperty(response, "url", { value: String(url) });
      return response;
    };

    const result = await ingestGitHubTemplateSource({
      url: "https://github.com/owner/repo",
      maxAttempts: 2,
      fetchImpl,
    });

    assert.equal(archiveCalls, 2, "the pipeline must forward its attempt count to the downloader");
    assert.equal(result.success, false);
    assert.equal(result.stageFailed, "DOWNLOAD");
  });

  it("uses the pipeline's default attempt count when none is supplied", async () => {
    let archiveCalls = 0;
    const fetchImpl = async (url) => {
      const target = String(url);
      if (target.includes("/commits/")) {
        return new Response(JSON.stringify({ sha: "b".repeat(40) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      archiveCalls += 1;
      const response = new Response("temporarily unavailable", { status: 503 });
      Object.defineProperty(response, "url", { value: String(url) });
      return response;
    };

    await ingestGitHubTemplateSource({
      url: "https://github.com/owner/repo",
      fetchImpl,
    });

    assert.equal(archiveCalls, 3, "the default attempt count is 3");
  });

  it("keeps the archive size limit enforced", async () => {
    const body = Buffer.alloc(2048);
    const response = new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/gzip", "Content-Length": String(body.length) },
    });
    Object.defineProperty(response, "url", { value: TRUSTED_URL });

    const result = await downloadSourceArchive({
      owner: "owner",
      repo: "repo",
      sha: "a".repeat(40),
      maxSizeBytes: 512,
      maxAttempts: 1,
      fetchImpl: async () => response,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /exceeds permitted maximum limit/);
  });

  it("keeps the trusted host restriction enforced on redirects", async () => {
    const response = new Response("archive", { status: 200 });
    Object.defineProperty(response, "url", { value: "https://evil.example/archive" });

    const result = await downloadSourceArchive({
      owner: "owner",
      repo: "repo",
      sha: "a".repeat(40),
      maxAttempts: 1,
      fetchImpl: async () => response,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /untrusted URL/);
  });

  it("keeps the extracted size limit enforced", async () => {
    const tarball = createMockTarball([
      { path: "owner-repo-sha/big.txt", content: "A".repeat(4096) },
    ]);

    const result = await inspectSourceArchive(tarball, { maxExtractedSizeBytes: 512 });

    assert.equal(result.success, false);
    assert.match(result.error, /exceeds maximum size limit of 512 bytes/);
  });

  it("keeps the extracted file count limit enforced", async () => {
    const tarball = createMockTarball([
      { path: "owner-repo-sha/a.txt", content: "a" },
      { path: "owner-repo-sha/b.txt", content: "b" },
      { path: "owner-repo-sha/c.txt", content: "c" },
    ]);

    const result = await inspectSourceArchive(tarball, { maxFileCount: 2 });

    assert.equal(result.success, false);
    assert.match(result.error, /exceeds maximum allowable file count of 2/);
  });
});
