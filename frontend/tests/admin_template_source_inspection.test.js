/**
 * Frontend Regression Test: Admin Source Inspection and Review Decision Rules
 *
 * Verifies:
 * 1. A review decision without a justification reason is refused — including
 *    an approval, which cannot be audited later without one.
 * 2. An approval continues the pipeline with the same pinned commit, as a
 *    retry, so the existing immutable version is reused.
 * 3. The source-inspection service calls the read-only source endpoint and
 *    never the artifact preview endpoint.
 * 4. A failing source inspection reports its error rather than an empty
 *    snapshot.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const COMPONENT_PATH = path.join(ROOT, "components", "dashboard", "admin", "TemplateSubmissionPage.jsx");
const SERVICE_PATH = path.join(ROOT, "services", "template-admin.js");

function loadComponent() {
  const source = fs.readFileSync(COMPONENT_PATH, "utf8");
  const ts = require(path.resolve(__dirname, "..", "..", "backend", "node_modules", "typescript"));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  });
  const sandbox = {
    React: {
      useState: (init) => [init, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
    },
    window: {},
    module: { exports: {} },
    exports: {},
  };
  vm.runInNewContext(compiled.outputText, sandbox);
  return sandbox.module.exports;
}

/** Loads the template-admin service against a recording fetch double. */
function loadService(fetchDouble) {
  const source = fs.readFileSync(SERVICE_PATH, "utf8");
  const calls = [];
  const sandbox = {
    window: {
      OV: { core: { db: { get: () => null } }, services: {} },
      OV_ENV: { API_BASE: "http://localhost:3000/api" },
    },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return fetchDouble(String(url), init);
    },
    module: { exports: {} },
    console,
  };
  sandbox.window.fetch = sandbox.fetch;
  vm.runInNewContext(source, sandbox);
  return { service: sandbox.window.OV.services.templateAdmin, calls };
}

describe("Admin Source Inspection - review decision rules", () => {
  const component = loadComponent();

  it("1. refuses a review decision without a justification reason", () => {
    assert.equal(typeof component.validateReviewDecision, "function");

    for (const decision of [
      { decision: "approve", reason: "" },
      { decision: "approve", reason: "   " },
      { decision: "reject", reason: "" },
      { decision: "reject", reason: "\n\t " },
      { decision: "approve" },
      { decision: "approve", reason: null },
      {},
    ]) {
      const result = component.validateReviewDecision(decision);
      assert.equal(result.ok, false, JSON.stringify(decision));
      assert.match(result.error, /justification reason/i);
    }
  });

  it("2. accepts a justified decision and trims the reason", () => {
    const result = component.validateReviewDecision({ decision: "approve", reason: "  Reviewed and accepted.  " });
    assert.equal(result.ok, true);
    assert.equal(result.reason, "Reviewed and accepted.");
  });

  it("3. continues an approval with the same pinned commit, as a retry", () => {
    const submission = {
      ingestionId: "ing_demo",
      sourceUrl: "https://github.com/owner/repo",
      commitSha: "a".repeat(40),
    };
    const continuation = component.buildApprovalContinuation(submission, "Reviewed and accepted.");

    assert.equal(continuation.url, "https://github.com/owner/repo");
    assert.equal(continuation.commitSha, "a".repeat(40));
    assert.equal(continuation.reason, "Reviewed and accepted.");
    assert.equal(continuation.policyOverride, true);
    assert.equal(continuation.retry, true);
    assert.equal(continuation.explicitConfirmation, true);
  });

  it("4. the source inspection reads the read-only source endpoint, not the artifact preview", async () => {
    const { service, calls } = loadService(async () =>
      new Response(JSON.stringify({ success: true, source: { snapshotId: "ing_demo" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await service.sourceSnapshot("ing_demo");
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/admin\/templates\/source\?ingestionId=ing_demo$/);
    assert.ok(!calls[0].url.includes("/preview"), "source inspection must not call the artifact preview");
  });

  it("5. reads a single source file by its relative path", async () => {
    const { service, calls } = loadService(async () =>
      new Response(JSON.stringify({ success: true, file: { relativePath: "README.md", content: "# hi" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await service.sourceFile("ing_demo", "src/app.js");
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/admin\/templates\/source\?ingestionId=ing_demo&path=src%2Fapp\.js$/);
  });

  it("6. reports a failed source inspection instead of an empty snapshot", async () => {
    const { service } = loadService(async () =>
      new Response(JSON.stringify({ success: false, code: "SOURCE_SNAPSHOT_MISSING", message: "No retained source." }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    );

    await assert.rejects(
      () => service.sourceSnapshot("ing_demo"),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, "SOURCE_SNAPSHOT_MISSING");
        assert.match(error.message, /No retained source/);
        return true;
      }
    );
  });
});
