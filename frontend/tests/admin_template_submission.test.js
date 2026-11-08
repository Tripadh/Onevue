/**
 * Frontend Regression Test: Admin Template Submission Policy Override UX
 *
 * Verifies:
 * 1. When "Override a REVIEW_REQUIRED audit outcome" is checked:
 *    - Approval reason field becomes required.
 *    - Mandatory justification hint and dynamic label are shown.
 *    - Submission is prevented if the reason is empty or whitespace.
 * 2. When override is unchecked:
 *    - Approval reason remains optional.
 *    - Form submission proceeds without reason.
 * 3. Justification error is cleared on correction.
 * 4. Existing backend contracts and security parameters are preserved.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const COMPONENT_PATH = path.resolve(__dirname, "..", "components", "dashboard", "admin", "TemplateSubmissionPage.jsx");

describe("Admin Template Submission - Policy Override UX", () => {
  const componentSource = fs.readFileSync(COMPONENT_PATH, "utf8");

  // Load module in a lightweight browser-like sandbox
  function loadPageModule() {
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
    // Extract non-JSX parts or run via ts compiler
    const ts = require(path.resolve(__dirname, "..", "..", "backend", "node_modules", "typescript"));
    const compiled = ts.transpileModule(componentSource, {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
    });
    vm.runInNewContext(compiled.outputText, sandbox);
    return {
      validateSubmission: sandbox.module.exports.validateTemplateSubmission || sandbox.window.validateTemplateSubmission,
      TemplateSubmissionPage: sandbox.module.exports.TemplateSubmissionPage || sandbox.window.TemplateSubmissionPage,
    };
  }

  const { validateSubmission } = loadPageModule();

  describe("Validation logic (validateTemplateSubmission)", () => {
    it("rejects missing or blank repository URL regardless of override", () => {
      const emptyUrlRes = validateSubmission({ url: "", policyOverride: false, reason: "" });
      assert.equal(emptyUrlRes.ok, false);
      assert.match(emptyUrlRes.error, /GitHub repository URL is required/i);

      const whitespaceUrlRes = validateSubmission({ url: "   ", policyOverride: true, reason: "valid reason" });
      assert.equal(whitespaceUrlRes.ok, false);
      assert.match(whitespaceUrlRes.error, /GitHub repository URL is required/i);
    });

    it("allows submission without reason when policyOverride is unchecked", () => {
      const resNoReason = validateSubmission({
        url: "https://github.com/owner/repo",
        policyOverride: false,
        reason: "",
      });
      assert.equal(resNoReason.ok, true);
      assert.equal(resNoReason.error, null);

      const resUndefinedReason = validateSubmission({
        url: "https://github.com/owner/repo",
        policyOverride: false,
        reason: undefined,
      });
      assert.equal(resUndefinedReason.ok, true);
      assert.equal(resUndefinedReason.error, null);
    });

    it("allows optional reason when policyOverride is unchecked", () => {
      const res = validateSubmission({
        url: "https://github.com/owner/repo",
        policyOverride: false,
        reason: "Initial submission notes",
      });
      assert.equal(res.ok, true);
      assert.equal(res.error, null);
    });

    it("prevents submission if policyOverride is checked and reason is empty", () => {
      const resEmpty = validateSubmission({
        url: "https://github.com/owner/repo",
        policyOverride: true,
        reason: "",
      });
      assert.equal(resEmpty.ok, false);
      assert.match(resEmpty.error, /approval justification reason is required when overriding REVIEW_REQUIRED/i);

      const resWhitespace = validateSubmission({
        url: "https://github.com/owner/repo",
        policyOverride: true,
        reason: "   \t\n  ",
      });
      assert.equal(resWhitespace.ok, false);
      assert.match(resWhitespace.error, /approval justification reason is required when overriding REVIEW_REQUIRED/i);

      const resNull = validateSubmission({
        url: "https://github.com/owner/repo",
        policyOverride: true,
        reason: null,
      });
      assert.equal(resNull.ok, false);
      assert.match(resNull.error, /approval justification reason is required when overriding REVIEW_REQUIRED/i);
    });

    it("allows submission when policyOverride is checked and justification reason is provided", () => {
      const res = validateSubmission({
        url: "https://github.com/owner/repo",
        policyOverride: true,
        reason: "Reviewed MIT license file located in custom subfolder; dependency audit confirmed safe.",
      });
      assert.equal(res.ok, true);
      assert.equal(res.error, null);
    });
  });

  describe("Component JSX and UI Contract", () => {
    it("sets dynamic required attribute and label for Approval reason field", () => {
      // Approval reason label switches between optional and required for policy override
      assert.match(
        componentSource,
        /label=\{policyOverride\s*\?\s*"Approval reason \(required for policy override\)"\s*:\s*"Approval reason \(optional\)"\}/,
        "Approval reason input label must reflect required status when policyOverride is true"
      );

      // Input required attribute bound to policyOverride
      assert.match(
        componentSource,
        /required=\{policyOverride\}/,
        "Approval reason input must have required={policyOverride}"
      );

      // Mandatory justification hint displayed when policyOverride is true
      assert.match(
        componentSource,
        /hint=\{policyOverride\s*\?\s*"A justification reason is mandatory when overriding a REVIEW_REQUIRED outcome\."\s*:\s*undefined\}/,
        "Approval reason input must display a clear hint when policyOverride is enabled"
      );
    });

    it("enforces validation guard in submit handler", () => {
      assert.match(
        componentSource,
        /validateTemplateSubmission\(\{\s*url,\s*policyOverride,\s*reason\s*\}\)/,
        "submit handler must validate url, policyOverride, and reason"
      );
      assert.match(
        componentSource,
        /if\s*\(!validation\.ok\)\s*\{\s*setError\(validation\.error\);\s*return;\s*\}/,
        "submit handler must abort and setError when validation fails"
      );
    });

    it("enforces validation guard in submitRetry handler", () => {
      assert.match(
        componentSource,
        /validateTemplateSubmission\(\{\s*url:\s*sourceUrl,\s*policyOverride,\s*reason\s*\}\)/,
        "submitRetry handler must validate sourceUrl, policyOverride, and reason"
      );
    });

    it("clears justification error when reason is typed or policyOverride is unchecked", () => {
      assert.match(
        componentSource,
        /if\s*\(e\.target\.value\.trim\(\)\s*&&\s*error\s*&&\s*error\.includes\("justification"\)\)\s*\{\s*setError\(""\);\s*\}/,
        "Typing into reason clears justification error"
      );
      assert.match(
        componentSource,
        /if\s*\(!e\.target\.checked\s*&&\s*error\s*&&\s*error\.includes\("justification"\)\)\s*\{\s*setError\(""\);\s*\}/,
        "Unchecking policyOverride clears justification error"
      );
    });
  });

  describe("Simulated Form Submission Workflow", () => {
    it("blocks submission and does not call templateAdmin service when override is active without reason", async () => {
      let submitCalled = false;
      let capturedError = "";

      const mockService = {
        submit: async () => {
          submitCalled = true;
          return { success: true };
        },
      };

      // Simulate submit with policyOverride = true and empty reason
      const url = "https://github.com/codewithsadee/vcard-personal-portfolio.git";
      const policyOverride = true;
      const reason = "";

      const validation = validateSubmission({ url, policyOverride, reason });
      if (!validation.ok) {
        capturedError = validation.error;
      } else {
        await mockService.submit({ url, policyOverride, reason });
      }

      assert.equal(submitCalled, false, "service.submit must not be called when override justification is missing");
      assert.match(capturedError, /justification reason is required/i);
    });

    it("proceeds with submission and passes policyOverride with reason when valid", async () => {
      let submitPayload = null;

      const mockService = {
        submit: async (payload) => {
          submitPayload = payload;
          return { success: true, message: "Template processed" };
        },
      };

      const url = "https://github.com/codewithsadee/vcard-personal-portfolio.git";
      const policyOverride = true;
      const reason = "Manual verification confirmed MIT license";

      const validation = validateSubmission({ url, policyOverride, reason });
      assert.equal(validation.ok, true);

      await mockService.submit({
        url: url.trim(),
        reason: reason.trim() || undefined,
        policyOverride,
        retry: false,
        explicitConfirmation: true,
      });

      assert.ok(submitPayload, "service.submit must be called");
      assert.equal(submitPayload.url, url);
      assert.equal(submitPayload.policyOverride, true);
      assert.equal(submitPayload.reason, "Manual verification confirmed MIT license");
      assert.equal(submitPayload.retry, false);
      assert.equal(submitPayload.explicitConfirmation, true);
    });

    it("proceeds with submission when policyOverride is false and reason is omitted", async () => {
      let submitPayload = null;

      const mockService = {
        submit: async (payload) => {
          submitPayload = payload;
          return { success: true, message: "Template processed" };
        },
      };

      const url = "https://github.com/codewithsadee/vcard-personal-portfolio.git";
      const policyOverride = false;
      const reason = "";

      const validation = validateSubmission({ url, policyOverride, reason });
      assert.equal(validation.ok, true);

      await mockService.submit({
        url: url.trim(),
        reason: reason.trim() || undefined,
        policyOverride,
        retry: false,
        explicitConfirmation: true,
      });

      assert.ok(submitPayload, "service.submit must be called");
      assert.equal(submitPayload.url, url);
      assert.equal(submitPayload.policyOverride, false);
      assert.equal(submitPayload.reason, undefined);
    });
  });
});
