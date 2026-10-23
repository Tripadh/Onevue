import assert from "node:assert/strict";
import * as dns from "node:dns";
import { once } from "node:events";
import https from "node:https";
import type { Server } from "node:http";
import { mock, describe, it } from "node:test";
import type { IssuerVerificationAdapter } from "../src/adapters/issuer-verification-adapter.js";
import type { IssuerVerificationResult } from "../src/adapters/issuer-verification-adapter.js";
import { createApp, type CreateAppOptions } from "../src/app.js";
import type { CertificateRepository } from "../src/db/certificate-repository.js";
import { InMemoryCertificateRepository } from "../src/db/in-memory-certificate-repository.js";
import {
  SUBMISSION_RATE_LIMIT,
  VERIFICATION_RATE_LIMIT,
} from "../src/http/rate-limit.js";

const CREDENTIAL_ID = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
const URL = `https://www.credly.com/badges/${CREDENTIAL_ID}`;
const DECISION_TIME = "2026-10-16T08:00:00.000Z";
const FETCHED_AT = "2026-10-16T07:59:00.000Z";

interface CertificateBody {
  certificate: {
    id: string;
    status: string;
    attempts: number;
    failureReason: string | null;
    evidence: unknown;
    url: string;
    submittedAt: string;
  };
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
  };
}

async function withApp(
  repository: CertificateRepository,
  run: (baseUrl: string) => Promise<void>,
  adapter?: IssuerVerificationAdapter,
  options?: CreateAppOptions,
): Promise<void> {
  const server: Server = createApp(repository, adapter, options).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Expected the test server to listen on a TCP port.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

async function postCertificates(
  baseUrl: string,
  body: string,
  contentType: string | null = "application/json",
): Promise<Response> {
  const headers = new Headers();
  if (contentType !== null) {
    headers.set("content-type", contentType);
  }
  return fetch(`${baseUrl}/certificates`, {
    method: "POST",
    headers,
    body,
  });
}

async function postVerify(
  baseUrl: string,
  id: string,
  body = "{}",
): Promise<Response> {
  return fetch(`${baseUrl}/certificates/${id}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function confirmed(): IssuerVerificationResult {
  return {
    kind: "confirmed",
    evidence: {
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
      canonicalUrl: URL,
      found: true,
      holderName: "Ada Lovelace",
      courseName: "Systems",
      issuedDate: "2026-01-15",
      fetchedAt: FETCHED_AT,
    },
  };
}

function assertSafeError(
  response: Response,
  text: string,
  secret: string,
): void {
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("stack"), false);
  assert.equal(text.includes("ECONNREFUSED"), false);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

describe("HTTP hardening", () => {
  it("uses fixed in-process rate-limit windows", () => {
    assert.deepEqual(SUBMISSION_RATE_LIMIT, { limit: 30, windowMs: 60_000 });
    assert.deepEqual(VERIFICATION_RATE_LIMIT, {
      limit: 20,
      windowMs: 60_000,
    });
  });

  it("sends security headers and rejects unknown routes and query fields", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      assert.equal(health.headers.get("x-content-type-options"), "nosniff");
      assert.equal(health.headers.get("x-frame-options"), "DENY");
      assert.equal(health.headers.get("referrer-policy"), "no-referrer");
      assert.equal(health.headers.get("cache-control"), "no-store");
      assert.equal(
        health.headers.get("content-security-policy"),
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      assert.equal(health.headers.get("x-powered-by"), null);
      assert.equal(health.headers.get("access-control-allow-origin"), null);

      const queried = await fetch(`${baseUrl}/health?status=ok`);
      const queriedBody = (await queried.json()) as ErrorBody;
      assert.equal(queried.status, 400);
      assert.equal(queriedBody.error.code, "VALIDATION_ERROR");
      assert.equal(queriedBody.error.details?.[0]?.path, "status");

      const missing = await fetch(`${baseUrl}/missing`);
      const missingText = await missing.text();
      assert.equal(missing.status, 404);
      assert.deepEqual(JSON.parse(missingText), {
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found.",
        },
      });
      assert.equal(missingText.includes("<"), false);
      assert.equal(missing.headers.get("x-content-type-options"), "nosniff");
    });
  });

  it("rejects malformed, non-JSON, oversized, and injected certificate input", async () => {
    const calls: string[] = [];
    const adapter: IssuerVerificationAdapter = {
      issuer: "credly",
      async verify(input) {
        calls.push(input.url);
        return confirmed();
      },
    };

    await withApp(
      new InMemoryCertificateRepository(),
      async (baseUrl) => {
        const malformed = await postCertificates(baseUrl, '{"url":');
        const malformedText = await malformed.text();
        assert.equal(malformed.status, 400);
        assert.deepEqual(JSON.parse(malformedText), {
          error: {
            code: "MALFORMED_JSON",
            message: "Request JSON is malformed.",
          },
        });
        assertSafeError(malformed, malformedText, "SyntaxError");

        const text = await postCertificates(
          baseUrl,
          jsonBody({ url: URL, status: "VERIFIED" }),
          "text/plain",
        );
        assert.equal(text.status, 415);
        assert.equal(
          ((await text.json()) as ErrorBody).error.code,
          "UNSUPPORTED_MEDIA_TYPE",
        );

        const oversized = await postCertificates(
          baseUrl,
          jsonBody({ url: `https://example.com/${"a".repeat(20_000)}` }),
        );
        assert.equal(oversized.status, 413);
        assert.deepEqual(await oversized.json(), {
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "Request body is too large.",
          },
        });

        const injected = await postCertificates(
          baseUrl,
          jsonBody({
            url: URL,
            status: "VERIFIED",
            evidence: { found: true },
            issuer: "credly",
            credentialId: CREDENTIAL_ID,
            canonicalUrl: URL,
            attempts: 4,
            verifiedAt: DECISION_TIME,
            failureReason: null,
            submittedAt: DECISION_TIME,
          }),
        );
        const injectedBody = (await injected.json()) as ErrorBody;
        assert.equal(injected.status, 400);
        assert.equal(injectedBody.error.code, "VALIDATION_ERROR");
        const injectedDetails = JSON.stringify(injectedBody.error.details);
        for (const key of [
          "status",
          "evidence",
          "issuer",
          "credentialId",
          "canonicalUrl",
          "attempts",
          "verifiedAt",
          "failureReason",
          "submittedAt",
        ]) {
          assert.equal(injectedDetails.includes(key), true, key);
        }

        const queried = await fetch(`${baseUrl}/certificates?status=VERIFIED`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: jsonBody({ url: URL }),
        });
        assert.equal(queried.status, 400);
        assert.equal(
          ((await queried.json()) as ErrorBody).error.details?.[0]?.path,
          "status",
        );

        const created = await postCertificates(
          baseUrl,
          jsonBody({ url: URL }),
          "application/json; charset=utf-8",
        );
        const createdBody = (await created.json()) as CertificateBody;
        assert.equal(created.status, 202);
        assert.equal(createdBody.certificate.status, "PENDING");
        assert.equal(createdBody.certificate.attempts, 0);

        const duplicate = await postCertificates(
          baseUrl,
          jsonBody({ url: `${URL}?utm=copy#later` }),
        );
        const duplicateBody = (await duplicate.json()) as {
          created: boolean;
          certificate: { id: string; url: string; status: string };
        };
        assert.equal(duplicate.status, 200);
        assert.equal(duplicateBody.created, false);
        assert.equal(duplicateBody.certificate.id, createdBody.certificate.id);
        assert.equal(duplicateBody.certificate.url, URL);
        assert.equal(duplicateBody.certificate.status, "PENDING");

        const verifyQuery = await fetch(
          `${baseUrl}/certificates/${createdBody.certificate.id}/verify?status=VERIFIED`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          },
        );
        assert.equal(verifyQuery.status, 400);
        assert.equal(calls.length, 0);

        const verified = await postVerify(baseUrl, createdBody.certificate.id);
        const verifiedBody = (await verified.json()) as CertificateBody;
        assert.equal(verified.status, 200);
        assert.equal(verifiedBody.certificate.status, "VERIFIED");
        assert.equal(calls.length, 1);

        const again = await postVerify(
          baseUrl,
          createdBody.certificate.id,
          jsonBody({ status: "PENDING", evidence: { found: false } }),
        );
        assert.equal(again.status, 400);
        const stored = await fetch(
          `${baseUrl}/certificates/${createdBody.certificate.id}`,
        );
        const storedBody = (await stored.json()) as CertificateBody;
        assert.equal(storedBody.certificate.status, "VERIFIED");
        assert.equal(storedBody.certificate.attempts, 1);

        const repeat = await postVerify(baseUrl, createdBody.certificate.id);
        const repeatBody = (await repeat.json()) as CertificateBody;
        assert.equal(repeat.status, 200);
        assert.equal(repeatBody.certificate.status, "VERIFIED");
        assert.equal(repeatBody.certificate.attempts, 1);
        assert.equal(calls.length, 1);
      },
      adapter,
    );
  });

  it("limits repeated submissions and verification requests", async () => {
    let clock = 1_000_000;
    const options: CreateAppOptions = {
      now: () => clock,
      submissionRateLimit: { limit: 2, windowMs: 60_000 },
      verificationRateLimit: { limit: 2, windowMs: 60_000 },
    };
    await withApp(
      new InMemoryCertificateRepository(),
      async (baseUrl) => {
        const first = await postCertificates(baseUrl, jsonBody({ url: URL }));
        const firstBody = (await first.json()) as CertificateBody;
        assert.equal(first.status, 202);

        const second = await postCertificates(baseUrl, jsonBody({ url: URL }));
        assert.equal(second.status, 200);

        const blocked = await postCertificates(baseUrl, jsonBody({ url: URL }));
        const blockedText = await blocked.text();
        assert.equal(blocked.status, 429);
        assert.equal(blocked.headers.get("retry-after"), "60");
        assert.deepEqual(JSON.parse(blockedText), {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Try again later.",
          },
        });
        assertSafeError(blocked, blockedText, "127.0.0.1");

        const id = firstBody.certificate.id;
        const verifyFirst = await postVerify(baseUrl, id);
        const verifySecond = await postVerify(baseUrl, id);
        assert.equal(verifyFirst.status, 200);
        assert.equal(verifySecond.status, 200);
        const verifyBlocked = await postVerify(baseUrl, id);
        const verifyBlockedText = await verifyBlocked.text();
        assert.equal(verifyBlocked.status, 429);
        assert.equal(
          (JSON.parse(verifyBlockedText) as ErrorBody).error.code,
          "RATE_LIMITED",
        );
        assert.equal(verifyBlockedText.includes("credly"), false);

        const stored = await fetch(`${baseUrl}/certificates/${id}`);
        const storedBody = (await stored.json()) as CertificateBody;
        assert.equal(storedBody.certificate.status, "PENDING");
        assert.equal(storedBody.certificate.attempts, 2);
        assert.equal(storedBody.certificate.failureReason, null);

        clock += 60_000;
        const allowed = await postVerify(baseUrl, id);
        const allowedBody = (await allowed.json()) as CertificateBody;
        assert.equal(allowed.status, 200);
        assert.equal(allowedBody.certificate.attempts, 3);
      },
      undefined,
      options,
    );
  });

  it("hides unexpected rejection text", async () => {
    const secret = "ECONNREFUSED 203.0.113.10 at internal.lookup stack";
    const repository: CertificateRepository = {
      async create() {
        throw secret;
      },
      async findById() {
        return null;
      },
      async findByUserAndUrl() {
        return null;
      },
      async findByUserAndCredential() {
        return null;
      },
      async update() {
        throw new Error("update was not stubbed");
      },
    };

    await withApp(repository, async (baseUrl) => {
      const response = await postCertificates(baseUrl, jsonBody({ url: URL }));
      const text = await response.text();
      assert.equal(response.status, 500);
      assert.deepEqual(JSON.parse(text), {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      });
      assertSafeError(response, text, secret);
    });
  });

  it("keeps the default Credly adapter unsupported without a network request", async () => {
    const lookup = mock.method(dns.promises, "lookup");
    const request = mock.method(https, "request");
    try {
      await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
        const created = await postCertificates(baseUrl, jsonBody({ url: URL }));
        const createdBody = (await created.json()) as CertificateBody;
        const response = await postVerify(baseUrl, createdBody.certificate.id);
        const body = (await response.json()) as CertificateBody;
        assert.equal(response.status, 200);
        assert.equal(body.certificate.status, "PENDING");
        assert.equal(body.certificate.attempts, 1);
        assert.equal(body.certificate.evidence, null);
        assert.equal(body.certificate.failureReason, null);

        const hosts = lookup.mock.calls.map((call) =>
          String(call.arguments[0]),
        );
        assert.equal(
          hosts.some((host) => host.includes("credly")),
          false,
        );
        assert.equal(request.mock.calls.length, 0);
      });
    } finally {
      lookup.mock.restore();
      request.mock.restore();
    }
  });
});
