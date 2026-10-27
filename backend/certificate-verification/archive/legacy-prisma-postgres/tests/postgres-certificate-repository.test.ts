import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import type { Server } from "node:http";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { IssuerVerificationResult } from "../src/adapters/issuer-verification-adapter.js";
import { createApp } from "../src/app.js";
import { assertTestDatabaseUrl } from "../src/db/database-config.js";
import { LOCAL_DEV_USER_ID } from "../src/db/certificate.js";
import {
  CertificateConflictError,
  InvalidCertificateUpdateError,
} from "../src/db/certificate-repository.js";
import {
  PostgresCertificateRepository,
  createPrismaClient,
} from "../src/db/postgres-certificate-repository.js";
import { verifyPendingCertificate } from "../src/services/verify-certificate.js";

const execFileAsync = promisify(execFile);
const TEST_DATABASE_URL = process.env.CERTIFICATE_TEST_DATABASE_URL;
const CREDENTIAL_ID = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const URL = `https://www.credly.com/badges/${CREDENTIAL_ID}`;
const DECISION_TIME = "2026-10-16T08:00:00.000Z";
const FETCHED_AT = "2026-10-16T07:59:00.000Z";
const OFFSET_TIME = "2026-10-16T13:30:00.000+05:30";

function confirmed(credentialId = CREDENTIAL_ID): IssuerVerificationResult {
  return {
    kind: "confirmed",
    evidence: {
      issuer: "credly",
      credentialId,
      canonicalUrl: `https://www.credly.com/badges/${credentialId}`,
      found: true,
      holderName: "Ada Lovelace",
      courseName: "Systems",
      issuedDate: "2026-01-15",
      fetchedAt: FETCHED_AT,
    },
  };
}

describe("PostgreSQL certificate repository errors", () => {
  it("hides database connection details", async () => {
    const secret =
      "password authentication failed for postgresql://user:s3cret@10.1.2.3:5432/certificates";
    const prisma = createPrismaClient(
      "postgresql://USER:PASSWORD@127.0.0.1:1/certificate_verification_test",
    );
    prisma.certificate.findUnique = (async () => {
      throw new Prisma.PrismaClientKnownRequestError(secret, {
        code: "P1001",
        clientVersion: "6.19.3",
      });
    }) as typeof prisma.certificate.findUnique;

    const repository = new PostgresCertificateRepository(prisma);
    await assert.rejects(
      () => repository.findById("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        if (error instanceof Error) {
          assert.equal(error.message.includes("s3cret"), false);
          assert.equal(error.message.includes("10.1.2.3"), false);
          assert.equal(
            error.message,
            "The certificate database request failed.",
          );
        }
        return true;
      },
    );
    await prisma.$disconnect();
  });
});

const integration = TEST_DATABASE_URL === undefined ? describe.skip : describe;

integration("PostgreSQL certificate repository", () => {
  const databaseUrl = TEST_DATABASE_URL ?? "";
  const prisma = createPrismaClient(
    databaseUrl.length === 0
      ? "postgresql://USER:PASSWORD@127.0.0.1:1/certificate_verification_test"
      : databaseUrl,
  );
  const repository = new PostgresCertificateRepository(prisma);

  it("applies migrations and stores certificate records", async () => {
    assertTestDatabaseUrl(databaseUrl);
    await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    await prisma.certificate.deleteMany();

    const created = await repository.create({
      url: URL,
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
    });
    assert.equal(created.created, true);
    assert.equal(created.certificate.userId, LOCAL_DEV_USER_ID);
    assert.equal(created.certificate.status, "PENDING");
    assert.equal(created.certificate.evidence, null);
    assert.equal(created.certificate.attempts, 0);
    assert.equal(created.certificate.issuer, "credly");
    assert.equal(created.certificate.credentialId, CREDENTIAL_ID);

    const nullable = await repository.create({ url: `${URL}?bare=1` });
    assert.equal(nullable.created, true);
    assert.equal(nullable.certificate.issuer, null);
    assert.equal(nullable.certificate.credentialId, null);
    assert.equal(nullable.certificate.canonicalUrl, null);

    const duplicate = await repository.create({
      url: URL,
      issuer: "other",
      credentialId: "should-not-overwrite",
    });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.certificate.id, created.certificate.id);
    assert.equal(duplicate.certificate.issuer, "credly");
    assert.equal(duplicate.certificate.credentialId, CREDENTIAL_ID);

    const sameCredential = await repository.create({
      url: `${URL}?utm=2`,
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
    });
    assert.equal(sameCredential.created, false);
    assert.equal(sameCredential.certificate.id, created.certificate.id);
    assert.equal(sameCredential.certificate.url, URL);

    const found = await repository.findById(created.certificate.id);
    assert.equal(found?.url, URL);
    assert.equal(
      (await repository.findByUserAndUrl(LOCAL_DEV_USER_ID, URL))?.id,
      created.certificate.id,
    );
    assert.equal(
      (
        await repository.findByUserAndCredential(
          LOCAL_DEV_USER_ID,
          "credly",
          CREDENTIAL_ID,
        )
      )?.id,
      created.certificate.id,
    );
    assert.equal(await repository.findById("missing-id"), null);
  });

  it("stores legal transitions and rejects illegal ones", async () => {
    const created = await repository.create({
      url: `https://www.credly.com/badges/${OTHER_ID}`,
      canonicalUrl: `https://www.credly.com/badges/${OTHER_ID}`,
      issuer: "credly",
      credentialId: OTHER_ID,
    });
    const pending = await repository.update(created.certificate.id, {
      attempts: 1,
    });
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.verifiedAt, null);
    assert.equal(pending.failureReason, null);
    assert.equal(pending.url, created.certificate.url);
    assert.equal(pending.userId, LOCAL_DEV_USER_ID);
    assert.equal(pending.submittedAt, created.certificate.submittedAt);

    await assert.rejects(
      () =>
        repository.update(created.certificate.id, {
          attempts: 0,
        }),
      InvalidCertificateUpdateError,
    );
    await assert.rejects(
      () =>
        repository.update(created.certificate.id, {
          verifiedAt: DECISION_TIME,
          attempts: 2,
        }),
      InvalidCertificateUpdateError,
    );

    const verified = await repository.update(created.certificate.id, {
      status: "VERIFIED",
      verifiedAt: OFFSET_TIME,
      attempts: 2,
      evidence: {
        found: true,
        holderName: "Ada Lovelace",
        courseName: "Systems",
        issuedDate: "2026-01-15",
        fetchedAt: FETCHED_AT,
        summary: "Issuer confirmed the credential.",
      },
    });
    assert.equal(verified.status, "VERIFIED");
    assert.equal(verified.verifiedAt, OFFSET_TIME);
    assert.equal(verified.failureReason, null);
    assert.equal(verified.attempts, 2);

    await assert.rejects(
      () =>
        repository.update(created.certificate.id, {
          status: "UNVERIFIED",
          verifiedAt: DECISION_TIME,
          failureReason: "FIELD_MISMATCH",
          attempts: 3,
        }),
      InvalidCertificateUpdateError,
    );
    await assert.rejects(
      () =>
        repository.update(created.certificate.id, {
          status: "PENDING",
          attempts: 3,
        }),
      InvalidCertificateUpdateError,
    );
    const stored = await repository.findById(created.certificate.id);
    assert.equal(stored?.status, "VERIFIED");
    assert.equal(stored?.verifiedAt, OFFSET_TIME);
    assert.equal(stored?.attempts, 2);
  });

  it("rejects a credential collision without changing either record", async () => {
    const firstUrl = "https://www.credly.com/badges/collision-a";
    const secondUrl = "https://www.credly.com/badges/collision-b";
    const first = await repository.create({ url: firstUrl });
    const second = await repository.create({
      url: secondUrl,
      issuer: "credly",
      credentialId: "shared-credential",
    });

    await assert.rejects(
      () =>
        repository.update(first.certificate.id, {
          issuer: "credly",
          credentialId: "shared-credential",
        }),
      CertificateConflictError,
    );
    assert.equal(
      (await repository.findById(first.certificate.id))?.credentialId,
      null,
    );
    assert.equal(
      (await repository.findById(second.certificate.id))?.url,
      secondUrl,
    );
  });

  it("increments attempts once when two conditional updates race", async () => {
    const created = await repository.create({
      url: "https://www.credly.com/badges/attempt-race",
    });
    const results = await Promise.allSettled([
      repository.update(created.certificate.id, {
        attempts: 1,
        expectedAttempts: 0,
      }),
      repository.update(created.certificate.id, {
        attempts: 1,
        expectedAttempts: 0,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(
      rejected[0]?.status === "rejected" &&
        rejected[0].reason instanceof InvalidCertificateUpdateError,
      true,
    );
    assert.equal(
      (await repository.findById(created.certificate.id))?.attempts,
      1,
    );
  });

  it("keeps one final status when two decisions race", async () => {
    const created = await repository.create({
      url: "https://www.credly.com/badges/status-race",
      canonicalUrl: "https://www.credly.com/badges/status-race",
      issuer: "credly",
      credentialId: "status-race",
    });
    const verifiedPatch = {
      status: "VERIFIED" as const,
      verifiedAt: DECISION_TIME,
      attempts: 1,
      expectedAttempts: 0,
      failureReason: null,
      evidence: {
        found: true,
        holderName: "Ada Lovelace",
        courseName: "Systems",
        issuedDate: "2026-01-15",
        fetchedAt: FETCHED_AT,
        summary: "Issuer confirmed the credential.",
      },
    };
    const unverifiedPatch = {
      status: "UNVERIFIED" as const,
      verifiedAt: DECISION_TIME,
      attempts: 1,
      expectedAttempts: 0,
      failureReason: "NOT_FOUND" as const,
      evidence: {
        found: false,
        holderName: null,
        courseName: null,
        issuedDate: null,
        fetchedAt: FETCHED_AT,
        summary: "Issuer reported that the credential does not exist.",
      },
    };
    const results = await Promise.allSettled([
      repository.update(created.certificate.id, verifiedPatch),
      repository.update(created.certificate.id, unverifiedPatch),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const stored = await repository.findById(created.certificate.id);
    assert.equal(stored?.attempts, 1);
    assert.equal(
      stored?.status === "VERIFIED" || stored?.status === "UNVERIFIED",
      true,
    );
    if (stored?.status === "VERIFIED") {
      assert.equal(stored.failureReason, null);
      assert.equal(stored.evidence?.found, true);
    }
    if (stored?.status === "UNVERIFIED") {
      assert.equal(stored.failureReason, "NOT_FOUND");
      assert.equal(stored.evidence?.found, false);
    }
    await assert.rejects(
      () =>
        repository.update(created.certificate.id, {
          status: "PENDING",
          attempts: 2,
        }),
      InvalidCertificateUpdateError,
    );
  });

  it("returns one record when the same certificate is submitted concurrently", async () => {
    const url = "https://www.credly.com/badges/duplicate-race";
    const [first, second] = await Promise.all([
      repository.create({
        url,
        canonicalUrl: url,
        issuer: "credly",
        credentialId: "duplicate-race",
      }),
      repository.create({
        url,
        canonicalUrl: url,
        issuer: "credly",
        credentialId: "duplicate-race",
      }),
    ]);
    assert.equal(first.certificate.id, second.certificate.id);
    assert.equal(
      [first.created, second.created].filter((created) => created).length,
      1,
    );
    const rows = await prisma.certificate.count({
      where: { userId: LOCAL_DEV_USER_ID, url },
    });
    assert.equal(rows, 1);
  });

  it("verifies through the API without exposing the database user id", async () => {
    const server: Server = createApp(repository).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected the test server to listen on a TCP port.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const submittedUrl =
        "https://www.credly.com/badges/84e32d3a-b841-4e53-a172-e3e14ffe2bc2";
      const created = await fetch(`${baseUrl}/certificates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: submittedUrl }),
      });
      assert.equal(created.status, 202);
      const createdBody = (await created.json()) as {
        created: boolean;
        certificate: { id: string; status: string };
      };
      assert.equal(createdBody.created, true);
      assert.equal(createdBody.certificate.status, "PENDING");
      const duplicate = await fetch(`${baseUrl}/certificates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${submittedUrl}?utm=1` }),
      });
      const duplicateBody = (await duplicate.json()) as {
        created: boolean;
        certificate: { id: string };
      };
      assert.equal(duplicate.status, 200);
      assert.equal(duplicateBody.created, false);
      assert.equal(duplicateBody.certificate.id, createdBody.certificate.id);

      const freshId = "22222222-2222-4222-8222-222222222222";
      const freshUrl = `https://www.credly.com/badges/${freshId}`;
      const fresh = await repository.create({
        url: freshUrl,
        canonicalUrl: freshUrl,
        issuer: "credly",
        credentialId: freshId,
      });
      const outcome = await verifyPendingCertificate(
        repository,
        {
          issuer: "credly",
          async verify() {
            return confirmed(freshId);
          },
        },
        fresh.certificate.id,
        { now: () => new Date(DECISION_TIME) },
      );
      assert.equal(outcome.certificate.status, "VERIFIED");

      const response = await fetch(
        `${baseUrl}/certificates/${fresh.certificate.id}`,
      );
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.equal(text.includes("userId"), false);
      assert.equal(text.includes(LOCAL_DEV_USER_ID), false);
      const body = JSON.parse(text) as {
        certificate: { status: string; attempts: number; verifiedAt: string };
      };
      assert.equal(body.certificate.status, "VERIFIED");
      assert.equal(body.certificate.attempts, 1);
      assert.equal(body.certificate.verifiedAt, DECISION_TIME);
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
  });
});
