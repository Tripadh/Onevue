/**
 * Frontend certificate status rules and the Verify Certificate action.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const frontendRoot = path.resolve(__dirname, "..", "..", "frontend");

function loadCredentials(fetchImpl) {
  const context = {
    window: {
      OV_ENV: { API_BASE: "http://localhost:3000/api" },
      OV: {
        core: {
          db: { get() { return { token: "session-token" }; }, filter() { return []; }, find() { return null; } },
          http() { throw new Error("live client should not be used"); },
          latency() { return Promise.resolve(); },
          isLive() { return false; },
          ServiceError: class ServiceError extends Error {
            constructor(code, message) { super(message); this.code = code; }
          },
        },
        services: {},
      },
    },
    fetch: fetchImpl || (() => { throw new Error("unexpected fetch"); }),
    URL,
    decodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(path.join(frontendRoot, "services", "credentials.js"), "utf8"), context);
  return context.window.OV.services.credentials;
}

describe("certificate status display", () => {
  const credentials = loadCredentials();

  test("only VERIFIED produces a verified badge", () => {
    assert.equal(credentials.displayCertificateStatus({ status: "VERIFIED", recipientMatch: "matched" }).verified, true);
    assert.equal(credentials.displayCertificateStatus({ status: "VERIFIED" }).verified, false);
    assert.equal(credentials.displayCertificateStatus({ status: "VERIFIED", recipientMatch: "mismatched" }).verified, false);
    for (const status of ["PENDING", "UNVERIFIED", "", undefined]) {
      const display = credentials.displayCertificateStatus({ status });
      assert.equal(display.verified, false, status);
      assert.notEqual(display.label, "VERIFIED");
    }
    assert.match(credentials.displayCertificateStatus({ status: "PENDING" }).detail, /Not verified/);
    assert.match(credentials.displayCertificateStatus({ status: "PENDING" }).detail, /inconclusive/);
  });

  test("verification requests use the platform API and the credential id", () => {
    const source = fs.readFileSync(path.join(frontendRoot, "services", "credentials.js"), "utf8");
    assert.match(source, /API_BASE \+ '\/student\/certificates\/' \+ encodeURIComponent\(id\) \+ '\/verify'/);
    assert.match(source, /Authorization: 'Bearer ' \+ session\.token/);
    assert.doesNotMatch(source, /CERTIFICATE_SERVICE/);

    const page = fs.readFileSync(
      path.join(frontendRoot, "components", "dashboard", "student", "StudentIdentityPage.jsx"),
      "utf8",
    );
    assert.match(page, /Verify Certificate/);
    assert.match(page, /Verify with Issuer/);
    assert.match(page, /credentials\.verifyCertificate\(id, earnerEmail\)/);
    assert.match(page, /earnerEmails/);
    assert.doesNotMatch(page, /earnerEmail:\s*earnerEmail/);
    assert.match(page, /credentials\.submitCertificate\(url\)/);
    assert.match(page, /prepareCertificateSubmission\(credential\)/);
    assert.match(page, /if \(!prepared\.ok\)/);
    assert.match(page, /displayCertificateStatus/);
    assert.match(page, /\{crd\.verificationUrl\}/);
    assert.match(page, /credentialsFromSave\(updatedList, saved\)/);
    assert.match(page, /if \(!saved\) \{\s*setIsSubmitting\(false\);\s*return;\s*\}/);
    assert.match(page, /else if \(preparedUrl && preparedUrl\.ok\)/);
    assert.doesNotMatch(page, /submitCertificate\(\s*(credential\.(credentialId|title|issuer)|credForm\.(credentialId|title|issuer))/);
    const saveStart = page.indexOf("const handleSaveCredModal");
    const saveEnd = page.indexOf("const handleVerifyCertificate");
    const saveHandler = page.slice(saveStart, saveEnd);
    const failureAt = saveHandler.indexOf("if (!saved)");
    const closeAt = saveHandler.indexOf("setCredModalOpen(false)");
    assert.ok(failureAt > 0 && closeAt > failureAt);

    const dashboard = fs.readFileSync(
      path.join(frontendRoot, "components", "dashboard", "student", "StudentDashboard.jsx"),
      "utf8",
    );
    assert.match(dashboard, /profileSaveFeedback/);
    assert.match(dashboard, /tone: 'error'/);
  });

  test("submits the saved Credly URL and withholds missing, malformed, and unsupported URLs", async () => {
    const badge = "https://www.credly.com/badges/84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
    const calls = [];
    const credentials = loadCredentials(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return {
            created: true,
            certificate: {
              id: "84e32d3a-b841-4e53-a172-e3e14ffe2bc1",
              status: "PENDING",
            },
          };
        },
      };
    });

    const saved = {
      title: "Java Microservices with Spring Boot",
      issuer: "Edureka",
      credentialType: "course_certificate",
      credentialId: "10QG5GT9PJYN",
      credentialUrl: "",
      verificationUrl: `  ${badge}?utm=share  `,
    };
    const valid = credentials.prepareCertificateSubmission(saved);
    assert.equal(valid.ok, true);
    assert.equal(valid.reason, "valid");
    assert.equal(valid.source, "verificationUrl");
    assert.equal(valid.url, `${badge}?utm=share`);
    assert.equal(valid.url.includes(saved.credentialId), false);
    assert.equal(valid.url.includes(saved.title), false);

    await credentials.submitCertificate(valid.url);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:3000/api/student/certificates");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer session-token");
    assert.deepEqual(JSON.parse(calls[0].init.body), { url: `${badge}?utm=share` });

    const missing = credentials.prepareCertificateSubmission({
      title: saved.title,
      issuer: saved.issuer,
      credentialId: saved.credentialId,
      verificationUrl: "   ",
      credentialUrl: "",
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "missing");
    assert.match(missing.message, /Credly badge link/);

    const malformed = credentials.prepareCertificateSubmission({
      ...saved,
      verificationUrl: saved.credentialId,
    });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.reason, "malformed");
    assert.match(malformed.message, /http or https/);

    const unsupported = credentials.prepareCertificateSubmission({
      ...saved,
      verificationUrl: "https://www.coursera.org/account/accomplishments/verify/10QG5GT9PJYN",
      credentialUrl: badge,
    });
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.reason, "unsupported");
    assert.match(unsupported.message, /www\.credly\.com\/badges/);
    assert.equal(unsupported.url, undefined);

    const edureka = credentials.classifyCertificateUrl("https://www.edureka.co/certificate/java");
    assert.equal(edureka.ok, false);
    assert.equal(edureka.reason, "unsupported");

    const fromCredentialUrl = credentials.prepareCertificateSubmission({
      title: saved.title,
      credentialId: saved.credentialId,
      verificationUrl: "",
      credentialUrl: badge,
    });
    assert.equal(fromCredentialUrl.ok, true);
    assert.equal(fromCredentialUrl.source, "credentialUrl");
    assert.equal(fromCredentialUrl.url, badge);

    assert.equal(calls.length, 1);
  });

  test("keeps a saved verification URL from the profile response and reports a failed save", () => {
    const credentials = loadCredentials();
    const edited = "https://www.coursera.org/account/accomplishments/verify/NEWCODE123";
    const savedProfile = {
      headline: "Student",
      credentials: [
        {
          id: "crd-java",
          title: "Java Microservices with Spring Boot",
          issuer: "Edureka",
          credentialId: "10QG5GT9PJYN",
          verificationUrl: edited,
        },
        {
          id: "crd-other",
          title: "AWS Solutions Architect",
          issuer: "Amazon",
          verificationUrl: "https://www.credly.com/badges/84e32d3a-b841-4e53-a172-e3e14ffe2bc1",
        },
      ],
    };
    const shown = credentials.credentialsFromSave(
      [{ id: "crd-java", verificationUrl: "https://old.example/verify" }],
      savedProfile,
    );
    assert.equal(shown.length, 2);
    assert.equal(shown[0].verificationUrl, edited);
    assert.equal(shown[0].issuer, "Edureka");
    assert.equal(shown[1].title, "AWS Solutions Architect");

    const unsupported = credentials.classifyCertificateUrl(edited);
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.reason, "unsupported");

    const failure = credentials.profileSaveFeedback({
      ok: false,
      message: "Invalid verificationUrl in 'Java Microservices with Spring Boot'.",
    });
    assert.equal(failure.ok, false);
    assert.equal(failure.title, "Failed to save");
    assert.match(failure.body, /Invalid verificationUrl/);
    assert.equal(failure.profile, undefined);
  });
});
