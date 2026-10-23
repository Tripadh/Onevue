import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { describe, it } from "node:test";
import { createApp } from "../src/app.js";
import type { Certificate } from "../src/db/certificate.js";
import {
  CertificateConflictError,
  type CertificateRepository,
  type CreateCertificateResult,
} from "../src/db/certificate-repository.js";
import { InMemoryCertificateRepository } from "../src/db/in-memory-certificate-repository.js";
import { UNTRUSTED_CERTIFICATE_URL_MESSAGE } from "../src/validation/certificate-url.js";

const CREDENTIAL_ID = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
const URL = `https://www.credly.com/badges/${CREDENTIAL_ID}`;
const CANONICAL_URL = URL;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

async function withApp(
  repository: CertificateRepository,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createApp(repository).listen(0, "127.0.0.1");
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

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function stubRepository(
  overrides: Partial<CertificateRepository>,
): CertificateRepository {
  return {
    async create(): Promise<CreateCertificateResult> {
      throw new Error("create was not stubbed");
    },
    async findById(): Promise<Certificate | null> {
      return null;
    },
    async findByUserAndUrl(): Promise<Certificate | null> {
      return null;
    },
    async findByUserAndCredential(): Promise<Certificate | null> {
      return null;
    },
    async update(): Promise<Certificate> {
      throw new Error("update was not stubbed");
    },
    ...overrides,
  };
}

describe("certificate API", () => {
  it("accepts a URL and reads the pending certificate back", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ok" });

      const created = await postCertificates(baseUrl, jsonBody({ url: URL }));
      const createdBody = (await created.json()) as {
        created: boolean;
        certificate: Record<string, unknown>;
      };

      assert.equal(created.status, 202);
      assert.equal(createdBody.created, true);
      assert.equal(createdBody.certificate.status, "PENDING");
      assert.equal(createdBody.certificate.url, URL);
      assert.equal(createdBody.certificate.canonicalUrl, CANONICAL_URL);
      assert.equal(createdBody.certificate.issuer, "credly");
      assert.equal(createdBody.certificate.credentialId, CREDENTIAL_ID);
      assert.equal(createdBody.certificate.evidence, null);
      assert.equal(createdBody.certificate.verifiedAt, null);
      assert.equal(createdBody.certificate.failureReason, null);
      assert.equal(createdBody.certificate.attempts, 0);
      assert.equal("userId" in createdBody.certificate, false);
      assert.equal(
        JSON.stringify(createdBody).includes("local-dev-user"),
        false,
      );

      const id = createdBody.certificate.id;
      assert.equal(typeof id, "string");

      const fetched = await fetch(`${baseUrl}/certificates/${String(id)}`);
      const fetchedBody = (await fetched.json()) as {
        certificate: Record<string, unknown>;
      };
      assert.equal(fetched.status, 200);
      assert.deepEqual(fetchedBody.certificate, createdBody.certificate);
    });
  });

  it("returns the existing certificate for a trimmed duplicate URL", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const firstResponse = await postCertificates(
        baseUrl,
        jsonBody({ url: `  ${URL}  ` }),
      );
      const first = (await firstResponse.json()) as {
        created: boolean;
        certificate: { id: string; url: string; submittedAt: string };
      };
      assert.equal(firstResponse.status, 202);
      assert.equal(first.certificate.url, URL);

      const duplicateResponse = await postCertificates(
        baseUrl,
        jsonBody({ url: URL }),
      );
      const duplicate = (await duplicateResponse.json()) as {
        created: boolean;
        certificate: {
          id: string;
          url: string;
          submittedAt: string;
          status: string;
        };
      };

      assert.equal(duplicateResponse.status, 200);
      assert.equal(duplicate.created, false);
      assert.equal(duplicate.certificate.id, first.certificate.id);
      assert.equal(
        duplicate.certificate.submittedAt,
        first.certificate.submittedAt,
      );
      assert.equal(duplicate.certificate.status, "PENDING");
    });
  });

  it("returns 404 for a missing UUID and 400 for an invalid id", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/certificates/${MISSING_ID}`);
      const missingBody = (await missing.json()) as {
        error: { code: string };
      };
      assert.equal(missing.status, 404);
      assert.equal(missingBody.error.code, "NOT_FOUND");

      const invalid = await fetch(`${baseUrl}/certificates/not-a-uuid`);
      const invalidBody = (await invalid.json()) as {
        error: { code: string; details: Array<{ path: string }> };
      };
      assert.equal(invalid.status, 400);
      assert.equal(invalidBody.error.code, "VALIDATION_ERROR");
      assert.equal(invalidBody.error.details[0]?.path, "id");
    });
  });

  it("rejects invalid certificate submissions", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const cases: Array<{ body: unknown; message: string; path: string }> = [
        { body: {}, message: "url is required.", path: "url" },
        { body: { url: 123 }, message: "url must be a string.", path: "url" },
        { body: { url: "   " }, message: "url is required.", path: "url" },
        {
          body: { url: "not a url" },
          message: "url must be an absolute http or https URL.",
          path: "url",
        },
        {
          body: { url: `https://example.com/${"a".repeat(2048)}` },
          message: "url must be at most 2048 characters.",
          path: "url",
        },
        {
          body: { url: URL, status: "VERIFIED" },
          message: 'Unrecognized key: "status"',
          path: "status",
        },
      ];

      for (const testCase of cases) {
        const response = await postCertificates(
          baseUrl,
          jsonBody(testCase.body),
        );
        const body = (await response.json()) as {
          error: {
            code: string;
            details: Array<{ path: string; message: string }>;
          };
        };
        assert.equal(response.status, 400, JSON.stringify(testCase.body));
        assert.equal(body.error.code, "VALIDATION_ERROR");
        assert.equal(body.error.details[0]?.path, testCase.path);
        assert.equal(body.error.details[0]?.message, testCase.message);
      }
    });
  });

  it("returns a malformed JSON error without a stack trace", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const response = await postCertificates(baseUrl, '{"url":');
      const body = (await response.json()) as {
        error: { code: string; message: string; details?: unknown };
      };

      assert.equal(response.status, 400);
      assert.deepEqual(body, {
        error: {
          code: "MALFORMED_JSON",
          message: "Request JSON is malformed.",
        },
      });
    });
  });

  it("hides internal fields and raw issuer content", async () => {
    const repository = stubRepository({
      async findById(id: string): Promise<Certificate | null> {
        return {
          id,
          userId: "local-dev-user",
          url: URL,
          canonicalUrl: null,
          issuer: null,
          credentialId: null,
          status: "PENDING",
          evidence: {
            found: false,
            holderName: null,
            courseName: null,
            issuedDate: null,
            fetchedAt: "2026-10-16T08:00:00.000Z",
            summary: "Issuer summary.",
            rawBody: "<html>secret issuer page</html>",
          } as Certificate["evidence"],
          submittedAt: "2026-10-16T08:00:00.000Z",
          verifiedAt: null,
          attempts: 0,
          failureReason: null,
        };
      },
    });

    await withApp(repository, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/certificates/${MISSING_ID}`);
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.equal(text.includes("userId"), false);
      assert.equal(text.includes("local-dev-user"), false);
      assert.equal(text.includes("rawBody"), false);
      assert.equal(text.includes("secret issuer page"), false);
      assert.equal(text.includes("stack"), false);
    });
  });

  it("returns a fixed message for unexpected repository errors", async () => {
    const repository = stubRepository({
      async create(): Promise<CreateCertificateResult> {
        throw new Error("secret-backend-failure");
      },
    });

    await withApp(repository, async (baseUrl) => {
      const response = await postCertificates(baseUrl, jsonBody({ url: URL }));
      const body = await response.json();
      const text = JSON.stringify(body);

      assert.equal(response.status, 500);
      assert.deepEqual(body, {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      });
      assert.equal(text.includes("secret-backend-failure"), false);
      assert.equal(text.includes("stack"), false);
    });
  });

  it("maps a repository conflict to 409", async () => {
    const repository = stubRepository({
      async create(): Promise<CreateCertificateResult> {
        throw new CertificateConflictError("index mismatch");
      },
    });

    await withApp(repository, async (baseUrl) => {
      const response = await postCertificates(baseUrl, jsonBody({ url: URL }));
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.deepEqual(body, {
        error: {
          code: "CONFLICT",
          message: "The submission conflicts with an existing certificate.",
        },
      });
      assert.equal(JSON.stringify(body).includes("index mismatch"), false);
    });
  });

  it("rejects a non-JSON content type and an oversized JSON body", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const text = await postCertificates(
        baseUrl,
        jsonBody({ url: URL }),
        "text/plain",
      );
      assert.equal(text.status, 415);
      assert.deepEqual(await text.json(), {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json.",
        },
      });

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
    });
  });

  it("keeps query and fragment on the submitted URL only", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const submitted = `${URL}?utm=newsletter#share`;
      const response = await postCertificates(
        baseUrl,
        jsonBody({ url: `  ${submitted}  ` }),
      );
      const body = (await response.json()) as {
        created: boolean;
        certificate: {
          url: string;
          canonicalUrl: string;
          credentialId: string;
          status: string;
        };
      };

      assert.equal(response.status, 202);
      assert.equal(body.created, true);
      assert.equal(body.certificate.url, submitted);
      assert.equal(body.certificate.canonicalUrl, CANONICAL_URL);
      assert.equal(body.certificate.credentialId, CREDENTIAL_ID);
      assert.equal(body.certificate.status, "PENDING");
    });
  });

  it("returns the original certificate for another URL with the same credential", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const firstUrl = `${URL}?utm=1`;
      const firstResponse = await postCertificates(
        baseUrl,
        jsonBody({ url: firstUrl }),
      );
      const first = (await firstResponse.json()) as {
        certificate: { id: string; url: string; canonicalUrl: string };
      };

      const duplicateResponse = await postCertificates(
        baseUrl,
        jsonBody({ url: `${URL}?utm=2#later` }),
      );
      const duplicate = (await duplicateResponse.json()) as {
        created: boolean;
        certificate: {
          id: string;
          url: string;
          canonicalUrl: string;
          status: string;
        };
      };

      assert.equal(duplicateResponse.status, 200);
      assert.equal(duplicate.created, false);
      assert.equal(duplicate.certificate.id, first.certificate.id);
      assert.equal(duplicate.certificate.url, firstUrl);
      assert.equal(duplicate.certificate.canonicalUrl, CANONICAL_URL);
      assert.equal(duplicate.certificate.status, "PENDING");
    });
  });

  it("rejects untrusted certificate URLs before creating a record", async () => {
    await withApp(new InMemoryCertificateRepository(), async (baseUrl) => {
      const rejected = [
        URL.replace("https://", "http://"),
        URL.replace("www.credly.com", "www.credly.com."),
        `${URL}/public_url`,
        URL.replace(CREDENTIAL_ID, "abc123"),
      ];

      for (const url of rejected) {
        const response = await postCertificates(baseUrl, jsonBody({ url }));
        assert.equal(response.status, 400, url);
        assert.deepEqual(await response.json(), {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed.",
            details: [
              { path: "url", message: UNTRUSTED_CERTIFICATE_URL_MESSAGE },
            ],
          },
        });
      }

      const created = await postCertificates(baseUrl, jsonBody({ url: URL }));
      const body = (await created.json()) as { created: boolean };
      assert.equal(created.status, 202);
      assert.equal(body.created, true);
    });
  });
});
