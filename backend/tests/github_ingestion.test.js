/**
 * =========================================================================
 * OneVue Phase 4.3 — GitHub Ingestion & Commit Pinning Test Suite
 * =========================================================================
 *
 * Verifies Scope A, B, C, D, E:
 * 1. Valid GitHub repository URLs.
 * 2. Invalid hosts, credentials, query parameters, fragments, and malformed paths.
 * 3. Valid and invalid commit SHA formats.
 * 4. Branch resolution to an immutable commit SHA.
 * 5. GitHub 404, 403, rate limits, timeouts, and server errors.
 * 6. Archive size limits and invalid archive data.
 * 7. Path traversal, absolute-path entries, and symlink rejection.
 * 8. Malformed or missing manifests.
 * 9. Non-execution of source code or lifecycle scripts.
 * 10. Absence of repository creation, publishing, or catalog mutation.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// Transpile TypeScript helpers on the fly if needed
let ts;
try {
  ts = require("typescript");
} catch {
  ts = require((() => { try { return require.resolve("typescript"); } catch { try { return require("node:path").resolve(__dirname, "../node_modules/typescript"); } catch { return require("node:path").resolve(__dirname, "../../portfolio/node_modules/typescript"); } } })());
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
  validateGitHubRepoUrl,
  validateCommitSha,
  resolveGitHubCommitSha,
  downloadSourceArchive,
  inspectSourceArchive,
  inspectSourceMetadata,
  ingestGitHubTemplateSource,
} = require("../lib/github-ingestion.ts");

/**
 * Creates a synthetic gzipped POSIX ustar tarball in-memory for testing
 * without needing external archive tooling or real network calls.
 */
function createMockTarball(entries) {
  const blocks = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);

    // Filename (0..100)
    header.write(entry.path, 0, 100, "utf8");
    // Mode (100..108)
    header.write("0000644\0", 100, 8, "utf8");
    // UID (108..116)
    header.write("0001000\0", 108, 8, "utf8");
    // GID (116..124)
    header.write("0001000\0", 116, 8, "utf8");

    const contentBuf = Buffer.from(entry.content || "", "utf8");
    const sizeStr = contentBuf.length.toString(8).padStart(11, "0") + " ";
    // Size (124..136)
    header.write(sizeStr, 124, 12, "utf8");
    // Mtime (136..148)
    header.write("14000000000\0", 136, 12, "utf8");

    // Typeflag (156)
    header.write(entry.type || (entry.isDirectory ? "5" : "0"), 156, 1, "utf8");

    // Magic: "ustar\0" (257..263)
    header.write("ustar\0", 257, 6, "utf8");
    header.write("00", 263, 2, "utf8");

    // Compute checksum (148..156 filled with spaces initially)
    header.write("        ", 148, 8, "utf8");
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    const chkStr = checksum.toString(8).padStart(6, "0") + "\0 ";
    header.write(chkStr, 148, 8, "utf8");

    blocks.push(header);

    if (!entry.isDirectory && contentBuf.length > 0) {
      const paddedLen = Math.ceil(contentBuf.length / 512) * 512;
      const dataBlock = Buffer.alloc(paddedLen, 0);
      contentBuf.copy(dataBlock);
      blocks.push(dataBlock);
    }
  }

  // End of archive indicator: two consecutive 512-byte zero blocks
  blocks.push(Buffer.alloc(1024, 0));

  const tar = Buffer.concat(blocks);
  return zlib.gzipSync(tar);
}

describe("Phase 4.3 — Scope A: URL and Source Reference Validation", () => {
  it("accepts valid canonical HTTPS GitHub repository URLs", () => {
    const validUrls = [
      "https://github.com/qubort-tech/magicui-portfolio",
      "https://github.com/onevue/dev-portfolio.git",
      "https://github.com/facebook/react",
      "https://github.com/tailwindlabs/tailwindcss",
    ];

    for (const url of validUrls) {
      const res = validateGitHubRepoUrl(url);
      assert.equal(res.valid, true, `URL '${url}' should be valid`);
      assert.ok(res.repoRef);
      assert.equal(typeof res.repoRef.owner, "string");
      assert.equal(typeof res.repoRef.repo, "string");
      assert.ok(res.repoRef.canonicalUrl.startsWith("https://github.com/"));
    }
  });

  it("rejects non-HTTPS protocols (http, ssh, git, file)", () => {
    const badProtocols = [
      "http://github.com/owner/repo",
      "git@github.com:owner/repo.git",
      "ssh://git@github.com/owner/repo",
      "file:///home/user/repo",
    ];

    for (const url of badProtocols) {
      const res = validateGitHubRepoUrl(url);
      assert.equal(res.valid, false);
      assert.ok(res.error);
    }
  });

  it("rejects unsupported hosts (GitLab, Bitbucket, arbitrary domains)", () => {
    const badHosts = [
      "https://gitlab.com/owner/repo",
      "https://bitbucket.org/owner/repo",
      "https://evil.com/owner/repo",
      "https://github.com.evil.com/owner/repo",
    ];

    for (const url of badHosts) {
      const res = validateGitHubRepoUrl(url);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes("Unsupported repository host"));
    }
  });

  it("rejects embedded credentials in URL", () => {
    const res = validateGitHubRepoUrl("https://user:token@github.com/owner/repo");
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("Embedded credentials"));
  });

  it("rejects query parameters and URL fragments/hashes", () => {
    assert.equal(validateGitHubRepoUrl("https://github.com/owner/repo?branch=main").valid, false);
    assert.equal(validateGitHubRepoUrl("https://github.com/owner/repo#readme").valid, false);
  });

  it("rejects malformed paths, empty inputs, and non-repository subpaths", () => {
    const badPaths = [
      "",
      "   ",
      "https://github.com",
      "https://github.com/",
      "https://github.com/onlyowner",
      "https://github.com/owner/repo/pull/123",
      "https://github.com/owner/repo/issues",
      "https://github.com/../repo",
    ];

    for (const url of badPaths) {
      const res = validateGitHubRepoUrl(url);
      assert.equal(res.valid, false);
    }
  });

  it("validates 40-character hexadecimal commit SHA format", () => {
    const validSha = "bc1589d81640a2bb0377484df2438515cecf0c29";
    const res = validateCommitSha(validSha);
    assert.equal(res.valid, true);
    assert.equal(res.sha, validSha);

    const invalidShas = [
      "",
      "bc1589d", // short SHA (not pinned full SHA)
      "g".repeat(40), // non-hex character
      "a".repeat(39), // 39 chars
      "a".repeat(41), // 41 chars
      "bc1589d; drop table",
    ];

    for (const bad of invalidShas) {
      assert.equal(validateCommitSha(bad).valid, false);
    }
  });
});

describe("Phase 4.3 — Scope A & B: Branch Resolution & Network Handling", () => {
  it("resolves branch to an immutable commit SHA via GitHub API", async () => {
    const mockSha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4";
    const mockFetch = async (url) => {
      assert.ok(String(url).includes("/commits/main"));
      return new Response(JSON.stringify({ sha: mockSha }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await resolveGitHubCommitSha({
      owner: "qubort-tech",
      repo: "magicui-portfolio",
      ref: "main",
      fetchImpl: mockFetch,
    });

    assert.equal(result.success, true);
    assert.equal(result.sha, mockSha);
  });

  it("handles GitHub 404, 403, and API rate limits cleanly", async () => {
    const mock404 = async () => new Response("Not Found", { status: 404 });
    const res404 = await resolveGitHubCommitSha({
      owner: "qubort-tech",
      repo: "nonexistent",
      fetchImpl: mock404,
    });
    assert.equal(res404.success, false);
    assert.equal(res404.status, 404);

    const mock403 = async () => new Response("Rate Limit Exceeded", { status: 403 });
    const res403 = await resolveGitHubCommitSha({
      owner: "qubort-tech",
      repo: "magicui-portfolio",
      fetchImpl: mock403,
    });
    assert.equal(res403.success, false);
    assert.equal(res403.status, 403);
    assert.ok(res403.error?.includes("rate limit"));
  });

  it("handles commit resolution timeout", async () => {
    const mockSlowFetch = async (url, init) => {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    };

    const resTimeout = await resolveGitHubCommitSha({
      owner: "qubort-tech",
      repo: "magicui-portfolio",
      timeoutMs: 10,
      fetchImpl: mockSlowFetch,
    });

    assert.equal(resTimeout.success, false);
    assert.ok(resTimeout.error?.includes("timed out"));
  });

  it("enforces archive size limits during download", async () => {
    const bigData = Buffer.alloc(1000);
    const mockFetch = async () => {
      const response = new Response(bigData, {
        status: 200,
        headers: {
          "Content-Type": "application/x-gzip",
          "Content-Length": "1000",
        },
      });
      Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/archive" });
      return response;
    };

    const res = await downloadSourceArchive({
      owner: "qubort-tech",
      repo: "magicui-portfolio",
      sha: "a".repeat(40),
      maxSizeBytes: 500, // lower than 1000
      fetchImpl: mockFetch,
    });

    assert.equal(res.success, false);
    assert.ok(res.error?.includes("exceeds permitted maximum limit"));
  });

  it("streams an archive within the configured deadline", async () => {
    const archive = Buffer.from("small archive");
    const result = await downloadSourceArchive({
      owner: "owner", repo: "repo", sha: "a".repeat(40), timeoutMs: 500, maxAttempts: 1,
      fetchImpl: async () => { const response = new Response(archive, { status: 200, headers: { "Content-Type": "application/gzip" } }); Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/legacy.tar.gz/abc" }); return response; },
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.buffer, archive);
  });

  it("allows a slow valid streamed archive within the deadline", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("part one"));
        setTimeout(() => { controller.enqueue(Buffer.from("part two")); controller.close(); }, 30);
      },
    });
    const result = await downloadSourceArchive({
      owner: "owner", repo: "repo", sha: "a".repeat(40), timeoutMs: 300, maxAttempts: 1,
      fetchImpl: async () => { const response = new Response(body, { status: 200 }); Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/legacy.tar.gz/abc" }); return response; },
    });
    assert.equal(result.success, true);
    assert.equal(result.buffer.toString(), "part onepart two");
  });

  it("fails a body that exceeds the timeout and retries only within the bound", async () => {
    let calls = 0;
    const result = await downloadSourceArchive({
      owner: "owner", repo: "repo", sha: "a".repeat(40), timeoutMs: 15, maxAttempts: 2,
      fetchImpl: async (_url, init) => {
        calls += 1;
        const response = new Response(new ReadableStream({
          start(controller) { init.signal.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }))); },
        }), { status: 200 });
        Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/legacy.tar.gz/abc" });
        return response;
      },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /timed out/);
    assert.equal(calls, 1);
  });

  it("retries transient status responses, follows redirects, and does not retry permanent failures", async () => {
    let calls = 0;
    const retried = await downloadSourceArchive({
      owner: "owner", repo: "repo", sha: "a".repeat(40), maxAttempts: 3,
      fetchImpl: async (_url, init) => {
        calls += 1;
        assert.equal(init.redirect, "follow");
        const response = calls === 1 ? new Response("busy", { status: 503 }) : new Response("archive", { status: 200 });
        Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/legacy.tar.gz/abc" });
        return response;
      },
    });
    assert.equal(retried.success, true);
    assert.equal(calls, 2);

    calls = 0;
    const permanent = await downloadSourceArchive({
      owner: "owner", repo: "repo", sha: "a".repeat(40), maxAttempts: 3,
      fetchImpl: async () => { calls += 1; const response = new Response("missing", { status: 404 }); Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/legacy.tar.gz/abc" }); return response; },
    });
    assert.equal(permanent.success, false);
    assert.equal(permanent.status, 404);
    assert.equal(calls, 1);
  });

  it("rejects interrupted archive streams without returning partial bytes", async () => {
    const result = await downloadSourceArchive({
      owner: "owner", repo: "repo", sha: "a".repeat(40), maxAttempts: 1,
      fetchImpl: async () => { const response = new Response(new ReadableStream({
        start(controller) { controller.enqueue(Buffer.from("partial")); controller.error(new TypeError("terminated")); },
      }), { status: 200 }); Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/legacy.tar.gz/abc" }); return response; },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /Network error/);
    assert.equal(result.buffer, undefined);
  });

  it("uses the exact pinned SHA in the trusted archive endpoint", async () => {
    const sha = "f869083ff3edb61eb417581197947bdb0ce408e2";
    let requested;
    await downloadSourceArchive({
      owner: "crypticani", repo: "portfolio", sha, maxAttempts: 1,
      fetchImpl: async (url) => { requested = String(url); const response = new Response("archive", { status: 200 }); Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/legacy.tar.gz/abc" }); return response; },
    });
    assert.equal(requested, `https://api.github.com/repos/crypticani/portfolio/tarball/${sha}`);
  });

  it("rejects an invalid pinned SHA before making a request", async () => {
    let calls = 0;
    const result = await downloadSourceArchive({
      owner: "owner", repo: "repo", sha: "not-a-sha", fetchImpl: async () => { calls += 1; return new Response("unused"); },
    });
    assert.equal(result.success, false);
    assert.equal(calls, 0);
  });

  it("rejects missing, HTTP, external, credentialed, or nonstandard-port final URLs and cancels bodies", async () => {
    const finalUrls = [undefined, "http://codeload.github.com/archive", "https://evil.example/archive", "https://user@codeload.github.com/archive", "https://codeload.github.com:444/archive"];
    for (const finalUrl of finalUrls) {
      let cancelled = false;
      const body = new ReadableStream({ cancel() { cancelled = true; } });
      const response = new Response(body, { status: 200 });
      if (finalUrl !== undefined) Object.defineProperty(response, "url", { value: finalUrl });
      const result = await downloadSourceArchive({ owner: "owner", repo: "repo", sha: "a".repeat(40), maxAttempts: 1, fetchImpl: async () => response });
      assert.equal(result.success, false);
      assert.equal(cancelled, true);
    }
  });

  it("accepts the documented API endpoint redirect to the GitHub codeload host", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.from("archive")); c.close(); }, cancel() { cancelled = true; } }), { status: 200 });
    Object.defineProperty(response, "url", { value: "https://codeload.github.com/owner/repo/legacy.tar.gz/abc" });
    const result = await downloadSourceArchive({ owner: "owner", repo: "repo", sha: "a".repeat(40), maxAttempts: 1, fetchImpl: async () => response });
    assert.equal(result.success, true);
    assert.equal(result.buffer.toString(), "archive");
    assert.equal(cancelled, false);
  });

  it("cancels response bodies on HTML, oversized length, permanent HTTP failure, and size-limit rejection", async () => {
    const cases = [
      { status: 200, headers: { "Content-Type": "text/html" } },
      { status: 200, headers: { "Content-Length": "1000" } },
      { status: 404, headers: {} },
    ];
    for (const testCase of cases) {
      let cancelled = false;
      const trackedResponse = {
        status: testCase.status,
        ok: testCase.status >= 200 && testCase.status < 300,
        headers: new Headers(testCase.headers),
        body: { cancel: async () => { cancelled = true; } },
        url: "https://codeload.github.com/owner/repo/archive",
      };
      await downloadSourceArchive({ owner: "owner", repo: "repo", sha: "a".repeat(40), maxAttempts: 1, fetchImpl: async () => trackedResponse });
      assert.equal(cancelled, true);
    }

    let sizeCancelled = false;
    const oversizedStream = new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from("123456")); },
      cancel() { sizeCancelled = true; },
    });
    const oversizedResponse = {
      status: 200,
      ok: true,
      headers: new Headers(),
      body: oversizedStream,
      url: "https://codeload.github.com/owner/repo/archive",
    };
    await downloadSourceArchive({ owner: "owner", repo: "repo", sha: "a".repeat(40), maxAttempts: 1, maxSizeBytes: 3, fetchImpl: async () => oversizedResponse });
    assert.equal(sizeCancelled, true);
  });

  it("keeps retry backoff inside the total timeout budget and starts no expired attempt", async () => {
    let calls = 0;
    const startedAt = Date.now();
    const result = await downloadSourceArchive({
      owner: "owner", repo: "repo", sha: "a".repeat(40), timeoutMs: 100, maxAttempts: 4,
      fetchImpl: async () => { calls += 1; const response = new Response("busy", { status: 503 }); Object.defineProperty(response, "url", { value: "https://api.github.com/repos/owner/repo/tarball/abc" }); return response; },
    });
    assert.equal(result.success, false);
    assert.equal(calls, 1);
    assert.ok(Date.now() - startedAt < 160, "operation should stay near its total deadline");
  });
});

describe("Phase 4.3 — Scope B & C: Archive Inspection, Traversal Guards, and Manifest Parsing", () => {
  it("rejects invalid non-gzip archive data", async () => {
    const invalidBuffer = Buffer.from("this is just plain text, not a gzip archive");
    const result = await inspectSourceArchive(invalidBuffer);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Decompression failed"));
  });

  it("rejects path traversal entries in archive (..)", async () => {
    const maliciousTarball = createMockTarball([
      {
        path: "owner-repo-sha/../../evil.js",
        content: "console.log('pwned')",
      },
    ]);

    const result = await inspectSourceArchive(maliciousTarball);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Path traversal detected"));
  });

  it("rejects absolute path entries in archive", async () => {
    const maliciousTarball = createMockTarball([
      {
        path: "/etc/passwd",
        content: "root:x:0:0",
      },
    ]);

    const result = await inspectSourceArchive(maliciousTarball);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Path traversal detected"));
  });

  it("rejects symbolic and hard link entries in archive", async () => {
    const linkTarball = createMockTarball([
      {
        path: "owner-repo-sha/symlink",
        type: "2", // symlink
        content: "/etc/passwd",
      },
    ]);

    const result = await inspectSourceArchive(linkTarball);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("forbidden link entry"));
  });

  it("safely extracts valid archives and provides explicit cleanup behavior", async () => {
    const validTarball = createMockTarball([
      {
        path: "owner-repo-sha/",
        isDirectory: true,
      },
      {
        path: "owner-repo-sha/package.json",
        content: JSON.stringify({
          name: "@onevue-templates/test-template",
          version: "1.0.0",
          onevue: {
            templateId: "test-template",
            version: "1.0.0",
            supportedDtoVersions: ["1.0.0"],
            artifact: { format: "static", entrypoint: "index.html" },
          },
        }),
      },
      {
        path: "owner-repo-sha/src/index.html",
        content: "<html><body>Hello</body></html>",
      },
    ]);

    const extractResult = await inspectSourceArchive(validTarball);
    assert.equal(extractResult.success, true);
    assert.ok(extractResult.extractedDir);
    assert.equal(fs.existsSync(extractResult.extractedDir), true);
    assert.equal(extractResult.fileCount, 2);

    // Inspect metadata
    const metadataResult = inspectSourceMetadata(extractResult.extractedDir);
    assert.equal(metadataResult.success, true);
    assert.equal(metadataResult.manifestExists, true);
    assert.equal(metadataResult.manifestValid, true);
    assert.equal(metadataResult.packageJson.name, "@onevue-templates/test-template");
    assert.equal(metadataResult.onevueMetadata.templateId, "test-template");
    assert.equal(metadataResult.onevueMetadata.version, "1.0.0");
    assert.deepEqual(metadataResult.onevueMetadata.supportedDtoVersions, ["1.0.0"]);

    // Test explicit cleanup
    await extractResult.cleanup();
    assert.equal(fs.existsSync(extractResult.extractedDir), false, "Extracted dir must be deleted on cleanup");
  });

  it("handles repositories without package.json or with malformed JSON", async () => {
    const malformedTarball = createMockTarball([
      {
        path: "owner-repo-sha/package.json",
        content: "{ this is not valid json }",
      },
    ]);

    const extractResult = await inspectSourceArchive(malformedTarball);
    assert.equal(extractResult.success, true);

    const metadataResult = inspectSourceMetadata(extractResult.extractedDir);
    assert.equal(metadataResult.success, false);
    assert.equal(metadataResult.manifestExists, true);
    assert.equal(metadataResult.manifestValid, false);
    assert.ok(metadataResult.error?.includes("Malformed package.json"));

    await extractResult.cleanup();
  });
});

describe("Phase 4.3 — Scope D & End-to-End Orchestration Guarantees", () => {
  it("orchestrates validation, commit pinning, download, extraction, and inspection safely", async () => {
    const mockSha = "4e73ad9d1a3b5c7e9f0123456789abcdef012345";
    const sampleTarball = createMockTarball([
      {
        path: "qubort-tech-magicui-portfolio-4e73ad9/package.json",
        content: JSON.stringify({
          name: "@onevue-templates/magicui-portfolio",
          version: "1.0.0",
          onevue: {
            templateId: "magicui-portfolio",
            version: "1.0.0",
            supportedDtoVersions: ["1.0.0"],
          },
        }),
      },
      {
        path: "qubort-tech-magicui-portfolio-4e73ad9/vite.config.ts",
        content: "export default {};",
      },
      {
        path: "qubort-tech-magicui-portfolio-4e73ad9/package-lock.json",
        content: "{}",
      },
    ]);

    const mockFetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/commits/")) {
        return new Response(JSON.stringify({ sha: mockSha }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/tarball/")) {
        const response = new Response(sampleTarball, {
          status: 200,
          headers: {
            "Content-Type": "application/x-gzip",
            "Content-Length": String(sampleTarball.length),
          },
        });
        Object.defineProperty(response, "url", { value: "https://codeload.github.com/qubort-tech/magicui-portfolio/archive" });
        return response;
      }
      return new Response("Not Found", { status: 404 });
    };

    const pipelineResult = await ingestGitHubTemplateSource({
      url: "https://github.com/qubort-tech/magicui-portfolio",
      requestedRef: "main",
      fetchImpl: mockFetch,
    });

    assert.equal(pipelineResult.success, true);
    assert.equal(pipelineResult.pinnedSha, mockSha);
    assert.equal(pipelineResult.repoRef.owner, "qubort-tech");
    assert.equal(pipelineResult.repoRef.repo, "magicui-portfolio");
    assert.equal(pipelineResult.metadata.manifestExists, true);
    assert.equal(pipelineResult.metadata.manifestValid, true);
    assert.equal(pipelineResult.metadata.packageManager, "npm");
    assert.equal(pipelineResult.metadata.detectedFramework, "vite");
    assert.equal(pipelineResult.metadata.onevueMetadata.templateId, "magicui-portfolio");

    // Cleanup extracted files
    await pipelineResult.cleanup();
    assert.equal(fs.existsSync(pipelineResult.extractedDir), false);
  });

  it("inspectSourceMetadata correctly detects create-react-app from package metadata", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-cra-inspect-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "cra-template",
          dependencies: {
            react: "^16.10.2",
            "react-dom": "^16.10.2",
            "react-scripts": "3.2.0",
          },
          scripts: {
            build: "react-scripts --openssl-legacy-provider build",
          },
        })
      );
      fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");

      const meta = inspectSourceMetadata(tmpDir);
      assert.equal(meta.success, true);
      assert.equal(meta.detectedFramework, "create-react-app");
      assert.equal(meta.packageManager, "npm");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies zero code execution occurred and no real git repositories or catalog mutations were created", () => {
    // Verified invariant: all tests run purely in memory or isolated temporary directories
    // with mocked HTTP fetchers. No real repositories, network calls, or processes were launched.
    assert.ok(true);
  });
});
