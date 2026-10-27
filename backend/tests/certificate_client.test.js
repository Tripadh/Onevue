const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(compiled.outputText, filename);
};

const {
  parseCertificateSubmitBody,
  parseCertificateVerifyBody,
  callCertificateService,
  CertificateServiceError,
} = require(path.join(projectRoot, "lib", "certificate-client.ts"));
const {
  requestLlmExtraction,
  LlmServiceError,
} = require(path.join(projectRoot, "lib", "llm-client.ts"));

const BADGE =
  "https://www.credly.com/badges/84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
const CERTIFICATE_ID = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";

function certificate(status = "PENDING") {
  return {
    id: CERTIFICATE_ID,
    url: BADGE,
    canonicalUrl: BADGE,
    issuer: "credly",
    credentialId: CERTIFICATE_ID,
    status,
    evidence: null,
    submittedAt: "2026-10-17T00:00:00.000Z",
    verifiedAt: null,
    attempts: status === "PENDING" ? 0 : 1,
    failureReason: null,
  };
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

describe("certificate submission validation", () => {
  test("accepts only a url and rejects LLM or status claims", () => {
    assert.deepEqual(parseCertificateSubmitBody({ url: `  ${BADGE}  ` }), {
      url: BADGE,
    });
    assert.throws(
      () =>
        parseCertificateSubmitBody({
          url: BADGE,
          status: "VERIFIED",
          llmStatus: "VERIFIED",
        }),
      (error) => error instanceof CertificateServiceError && error.status === 400,
    );
    assert.throws(
      () => parseCertificateVerifyBody({ evidence: { found: true } }),
      (error) => error instanceof CertificateServiceError && error.status === 400,
    );
  });

  test("does not forward a forged verification claim", async () => {
    let called = false;
    const { server, baseUrl } = await listen((_req, res) => {
      called = true;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: true, certificate: certificate("PENDING") }));
    });
    try {
      assert.throws(
        () =>
          parseCertificateSubmitBody({
            url: BADGE,
            llm: { status: "verified" },
          }),
        CertificateServiceError,
      );
      assert.equal(called, false);

      const result = await callCertificateService(
        { baseUrl, token: "platform-token", timeoutMs: 2000 },
        "user-a",
        "/certificates",
        "POST",
        { url: BADGE },
      );
      assert.equal(result.certificate.status, "PENDING");
      assert.equal(called, true);
    } finally {
      server.close();
    }
  });
});

describe("certificate service client", () => {
  test("sends the authenticated user and returns a pending certificate", async () => {
    const { server, baseUrl } = await listen((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        assert.equal(req.headers.authorization, "Bearer platform-token");
        assert.equal(req.headers["x-onevue-user-id"], "abc123user");
        assert.deepEqual(JSON.parse(raw), { url: BADGE });
        res.writeHead(202, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ created: true, certificate: certificate("PENDING") }),
        );
      });
    });
    try {
      const result = await callCertificateService(
        { baseUrl, token: "platform-token", timeoutMs: 2000 },
        "abc123user",
        "/certificates",
        "POST",
        { url: BADGE },
      );
      assert.equal(result.status, 202);
      assert.equal(result.created, true);
      assert.equal(result.certificate.status, "PENDING");
    } finally {
      server.close();
    }
  });

  test("forwards only an optional earner email and does not treat issuer confirmation as ownership", async () => {
    assert.deepEqual(parseCertificateVerifyBody({}), {});
    assert.deepEqual(parseCertificateVerifyBody({ earnerEmail: "  ada@example.com  " }), {
      earnerEmail: "ada@example.com",
    });
    assert.throws(
      () => parseCertificateVerifyBody({ earnerEmail: "ada@example.com", status: "VERIFIED" }),
      (error) => error instanceof CertificateServiceError && error.status === 400,
    );
    const { server, baseUrl } = await listen((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        assert.deepEqual(JSON.parse(raw), { earnerEmail: "ada@example.com" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          certificate: {
            ...certificate("VERIFIED"),
            recipientMatch: "matched",
            evidence: {
              found: true,
              holderName: null,
              courseName: "Systems",
              issuedDate: "2024-12-20",
              fetchedAt: "2026-10-17T00:00:00.000Z",
              summary: "Issuer confirmed the credential, and the supplied earner email matches the badge recipient.",
            },
          },
        }));
      });
    });
    try {
      const result = await callCertificateService(
        { baseUrl, token: "platform-token", timeoutMs: 2000 },
        "abc123user",
        `/certificates/${CERTIFICATE_ID}/verify`,
        "POST",
        { earnerEmail: "ada@example.com" },
      );
      assert.equal(result.certificate.recipientMatch, "matched");
      assert.equal(result.certificate.status, "VERIFIED");
    } finally {
      server.close();
    }
  });

  test("rejects an invalid certificate service response", async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ certificate: { status: "VERIFIED" } }));
    });
    try {
      await assert.rejects(
        () =>
          callCertificateService(
            { baseUrl, token: "platform-token", timeoutMs: 2000 },
            "abc123user",
            "/certificates/84e32d3a-b841-4e53-a172-e3e14ffe2bc1",
            "GET",
          ),
        (error) =>
          error instanceof CertificateServiceError && error.status === 502,
      );
    } finally {
      server.close();
    }
  });

  test("reports service authentication failure without treating it as URL validation", async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: "UNAUTHORIZED",
            message: "Service authentication failed.",
          },
        }),
      );
    });
    try {
      await assert.rejects(
        () =>
          callCertificateService(
            { baseUrl, token: "platform-token", timeoutMs: 2000 },
            "abc123user",
            "/certificates",
            "POST",
            { url: BADGE },
          ),
        (error) => {
          assert.equal(error instanceof CertificateServiceError, true);
          assert.equal(error.status, 503);
          assert.equal(error.message, "Certificate service authentication failed.");
          assert.notEqual(error.message, "Request validation failed.");
          assert.equal(String(error.message).includes("platform-token"), false);
          assert.equal(String(error.message).includes(baseUrl), false);
          return true;
        },
      );
    } finally {
      server.close();
    }
  });

  test("reports the service unavailable when the connection times out", async () => {
    const { server, baseUrl } = await listen(() => {});
    try {
      await assert.rejects(
        () =>
          callCertificateService(
            { baseUrl, token: "platform-token", timeoutMs: 1000 },
            "abc123user",
            "/certificates",
            "POST",
            { url: BADGE },
          ),
        (error) => {
          assert.equal(error instanceof CertificateServiceError, true);
          assert.equal(error.status, 503);
          assert.equal(String(error.message).includes(baseUrl), false);
          assert.equal(String(error.message).includes("platform-token"), false);
          return true;
        },
      );
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe("LLM extraction client", () => {
  test("accepts an ok extraction and rejects a response that claims verification", async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "verified",
          data: { certificate: "VERIFIED" },
        }),
      );
    });
    try {
      await assert.rejects(
        () =>
          requestLlmExtraction(
            {
              filename: "resume.pdf",
              bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
              mediaType: "application/pdf",
            },
            { baseUrl, apiKey: "llm-test-key", timeoutMs: 2000 },
          ),
        (error) => error instanceof LlmServiceError && error.code === "invalid_response",
      );
    } finally {
      server.close();
    }
  });

  test("times out without exposing the API key", async () => {
    const { server, baseUrl } = await listen(() => {});
    try {
      await assert.rejects(
        () =>
          requestLlmExtraction(
            {
              filename: "resume.pdf",
              bytes: new Uint8Array([1, 2, 3]),
              mediaType: "application/pdf",
            },
            { baseUrl, apiKey: "llm-secret-key", timeoutMs: 500 },
          ),
        (error) => {
          assert.equal(error instanceof LlmServiceError, true);
          assert.equal(error.code, "timeout");
          assert.equal(String(error.message).includes("llm-secret-key"), false);
          return true;
        },
      );
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
