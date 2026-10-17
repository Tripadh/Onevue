import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_DEV_USER_ID } from "../src/db/certificate.js";
import type { CertificateEvidence } from "../src/db/certificate.js";
import {
  CertificateConflictError,
  CertificateNotFoundError,
  InvalidCertificateUpdateError,
} from "../src/db/certificate-repository.js";
import type { CertificatePatch } from "../src/db/certificate-repository.js";
import { InMemoryCertificateRepository } from "../src/db/in-memory-certificate-repository.js";

const DECISION_TIME = "2026-10-16T08:00:00.000Z";
const URL = "https://www.credly.com/badges/abc123";

function repository(): InMemoryCertificateRepository {
  return new InMemoryCertificateRepository();
}

function evidence(extra: Record<string, unknown> = {}): CertificateEvidence {
  return {
    found: true,
    holderName: "Ada Lovelace",
    courseName: "Systems",
    issuedDate: "2026-01-01",
    fetchedAt: "2026-10-16T07:59:00.000Z",
    summary: "Issuer confirmed the credential.",
    ...extra,
  };
}

describe("InMemoryCertificateRepository", () => {
  it("creates a pending certificate for the local user", async () => {
    const result = await repository().create({
      url: URL,
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: "abc123",
    });

    assert.equal(result.created, true);
    assert.equal(result.certificate.userId, LOCAL_DEV_USER_ID);
    assert.equal(result.certificate.url, URL);
    assert.equal(result.certificate.issuer, "credly");
    assert.equal(result.certificate.credentialId, "abc123");
    assert.equal(result.certificate.status, "PENDING");
    assert.equal(result.certificate.evidence, null);
    assert.equal(result.certificate.verifiedAt, null);
    assert.equal(result.certificate.attempts, 0);
    assert.equal(result.certificate.failureReason, null);
    assert.equal(
      Number.isNaN(Date.parse(result.certificate.submittedAt)),
      false,
    );
    assert.notEqual(result.certificate.id, "");
  });

  it("returns the existing URL record without overwriting it", async () => {
    const store = repository();
    const created = await store.create({ url: URL });
    await store.update(created.certificate.id, { attempts: 2 });

    const duplicate = await store.create({
      url: URL,
      issuer: "credly",
      credentialId: "new-id",
    });

    assert.equal(duplicate.created, false);
    assert.equal(duplicate.certificate.id, created.certificate.id);
    assert.equal(duplicate.certificate.attempts, 2);
    assert.equal(duplicate.certificate.status, "PENDING");
    assert.equal(duplicate.certificate.issuer, null);
    assert.equal(duplicate.certificate.credentialId, null);
  });

  it("returns the existing credential record without creating another URL", async () => {
    const store = repository();
    const created = await store.create({
      url: URL,
      issuer: "credly",
      credentialId: "abc123",
    });

    const duplicate = await store.create({
      url: "https://www.credly.com/badges/abc123?utm=copy",
      issuer: "credly",
      credentialId: "abc123",
    });

    assert.equal(duplicate.created, false);
    assert.equal(duplicate.certificate.id, created.certificate.id);
    assert.equal(duplicate.certificate.url, URL);
    assert.equal(
      await store.findByUserAndUrl(
        LOCAL_DEV_USER_ID,
        "https://www.credly.com/badges/abc123?utm=copy",
      ),
      null,
    );
  });

  it("keeps the credential index aligned after parsed fields are saved", async () => {
    const store = repository();
    const created = await store.create({ url: URL });

    assert.equal(
      await store.findByUserAndCredential(
        LOCAL_DEV_USER_ID,
        "credly",
        "abc123",
      ),
      null,
    );

    const updated = await store.update(created.certificate.id, {
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: "abc123",
    });

    assert.equal(updated.issuer, "credly");
    assert.equal(updated.credentialId, "abc123");
    assert.equal(
      (await store.findByUserAndUrl(LOCAL_DEV_USER_ID, URL))?.id,
      created.certificate.id,
    );
    assert.equal(
      (
        await store.findByUserAndCredential(
          LOCAL_DEV_USER_ID,
          "credly",
          "abc123",
        )
      )?.id,
      created.certificate.id,
    );
  });

  it("removes the old credential key when the credential is rekeyed", async () => {
    const store = repository();
    const created = await store.create({
      url: URL,
      issuer: "credly",
      credentialId: "abc123",
    });

    const rekeyed = await store.update(created.certificate.id, {
      issuer: "credly",
      credentialId: "xyz789",
    });

    assert.equal(rekeyed.credentialId, "xyz789");
    assert.equal(
      await store.findByUserAndCredential(
        LOCAL_DEV_USER_ID,
        "credly",
        "abc123",
      ),
      null,
    );
    assert.equal(
      (
        await store.findByUserAndCredential(
          LOCAL_DEV_USER_ID,
          "credly",
          "xyz789",
        )
      )?.id,
      created.certificate.id,
    );

    const reclaimed = await store.create({
      url: "https://www.credly.com/badges/abc123-reclaimed",
      issuer: "credly",
      credentialId: "abc123",
    });
    assert.equal(reclaimed.created, true);
    assert.notEqual(reclaimed.certificate.id, created.certificate.id);
  });

  it("removes the credential key when the credential is cleared", async () => {
    const store = repository();
    const created = await store.create({
      url: URL,
      issuer: "credly",
      credentialId: "abc123",
    });

    const cleared = await store.update(created.certificate.id, {
      credentialId: null,
    });

    assert.equal(cleared.issuer, "credly");
    assert.equal(cleared.credentialId, null);
    assert.equal(
      await store.findByUserAndCredential(
        LOCAL_DEV_USER_ID,
        "credly",
        "abc123",
      ),
      null,
    );
    assert.equal(
      (await store.findByUserAndUrl(LOCAL_DEV_USER_ID, URL))?.id,
      created.certificate.id,
    );

    const reclaimed = await store.create({
      url: "https://www.credly.com/badges/abc123-cleared",
      issuer: "credly",
      credentialId: "abc123",
    });
    assert.equal(reclaimed.created, true);
  });

  it("rejects a credential collision and leaves both records unchanged", async () => {
    const store = repository();
    const first = await store.create({
      url: URL,
      issuer: "credly",
      credentialId: "abc123",
    });
    const second = await store.create({
      url: "https://www.credly.com/badges/other",
    });

    await assert.rejects(
      () =>
        store.update(second.certificate.id, {
          issuer: "credly",
          credentialId: "abc123",
        }),
      CertificateConflictError,
    );

    assert.equal((await store.findById(second.certificate.id))?.issuer, null);
    assert.equal(
      (await store.findById(second.certificate.id))?.credentialId,
      null,
    );
    assert.equal(
      (
        await store.findByUserAndCredential(
          LOCAL_DEV_USER_ID,
          "credly",
          "abc123",
        )
      )?.id,
      first.certificate.id,
    );
  });

  it("does not overwrite either record when duplicate keys disagree", async () => {
    const store = repository();
    const byUrl = await store.create({ url: URL });
    const byCredential = await store.create({
      url: "https://www.credly.com/badges/other",
      issuer: "credly",
      credentialId: "abc123",
    });

    await assert.rejects(
      () =>
        store.create({
          url: URL,
          issuer: "credly",
          credentialId: "abc123",
        }),
      CertificateConflictError,
    );

    assert.equal((await store.findById(byUrl.certificate.id))?.issuer, null);
    assert.equal(
      (await store.findById(byCredential.certificate.id))?.url,
      "https://www.credly.com/badges/other",
    );
  });

  it("records VERIFIED with a decision time and an empty failure reason", async () => {
    const store = repository();
    const created = await store.create({ url: URL });
    const verified = await store.update(created.certificate.id, {
      status: "VERIFIED",
      verifiedAt: DECISION_TIME,
      evidence: evidence(),
    });

    assert.equal(verified.status, "VERIFIED");
    assert.equal(verified.verifiedAt, DECISION_TIME);
    assert.equal(verified.failureReason, null);
    assert.equal(
      verified.evidence?.summary,
      "Issuer confirmed the credential.",
    );
  });

  it("records UNVERIFIED with a decision time and a failure reason", async () => {
    const store = repository();
    const created = await store.create({ url: URL });
    const unverified = await store.update(created.certificate.id, {
      status: "UNVERIFIED",
      verifiedAt: DECISION_TIME,
      failureReason: "NOT_FOUND",
      attempts: 1,
    });

    assert.equal(unverified.status, "UNVERIFIED");
    assert.equal(unverified.verifiedAt, DECISION_TIME);
    assert.equal(unverified.failureReason, "NOT_FOUND");
    assert.equal(unverified.attempts, 1);
  });

  it("sets verifiedAt only when the final decision is recorded", async () => {
    const store = repository();
    const created = await store.create({ url: URL });
    assert.equal(created.certificate.verifiedAt, null);

    const pending = await store.update(created.certificate.id, { attempts: 1 });
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.verifiedAt, null);
    assert.equal(pending.failureReason, null);

    await assert.rejects(
      () =>
        store.update(created.certificate.id, {
          verifiedAt: DECISION_TIME,
          attempts: 2,
        }),
      InvalidCertificateUpdateError,
    );

    const stored = await store.findById(created.certificate.id);
    assert.equal(stored?.status, "PENDING");
    assert.equal(stored?.verifiedAt, null);
    assert.equal(stored?.attempts, 1);
  });

  it("keeps an issuer outage pending until retries are exhausted", async () => {
    const store = repository();
    const created = await store.create({ url: URL });

    const outage = await store.update(created.certificate.id, { attempts: 1 });
    assert.equal(outage.status, "PENDING");
    assert.equal(outage.failureReason, null);
    assert.equal(outage.verifiedAt, null);

    await assert.rejects(
      () =>
        store.update(created.certificate.id, {
          failureReason: "ISSUER_UNAVAILABLE",
          attempts: 2,
        }),
      InvalidCertificateUpdateError,
    );

    const stillPending = await store.findById(created.certificate.id);
    assert.equal(stillPending?.status, "PENDING");
    assert.equal(stillPending?.attempts, 1);
    assert.equal(stillPending?.failureReason, null);

    const exhausted = await store.update(created.certificate.id, {
      status: "UNVERIFIED",
      verifiedAt: DECISION_TIME,
      failureReason: "ISSUER_UNAVAILABLE",
      attempts: 3,
    });

    assert.equal(exhausted.status, "UNVERIFIED");
    assert.equal(exhausted.failureReason, "ISSUER_UNAVAILABLE");
    assert.equal(exhausted.verifiedAt, DECISION_TIME);
    assert.equal(exhausted.attempts, 3);
  });

  it("rejects ordinary updates after a final status", async () => {
    const verifiedStore = repository();
    const verified = await verifiedStore.create({ url: URL });
    await verifiedStore.update(verified.certificate.id, {
      status: "VERIFIED",
      verifiedAt: DECISION_TIME,
    });

    await assert.rejects(
      () =>
        verifiedStore.update(verified.certificate.id, {
          status: "UNVERIFIED",
          verifiedAt: DECISION_TIME,
          failureReason: "FIELD_MISMATCH",
        }),
      InvalidCertificateUpdateError,
    );
    await assert.rejects(
      () => verifiedStore.update(verified.certificate.id, {}),
      InvalidCertificateUpdateError,
    );
    assert.equal(
      (await verifiedStore.findById(verified.certificate.id))?.status,
      "VERIFIED",
    );

    const unverifiedStore = repository();
    const unverified = await unverifiedStore.create({
      url: "https://www.credly.com/badges/missing",
    });
    await unverifiedStore.update(unverified.certificate.id, {
      status: "UNVERIFIED",
      verifiedAt: DECISION_TIME,
      failureReason: "MAX_ATTEMPTS",
    });

    await assert.rejects(
      () => unverifiedStore.update(unverified.certificate.id, { attempts: 4 }),
      InvalidCertificateUpdateError,
    );
    assert.equal(
      (await unverifiedStore.findById(unverified.certificate.id))?.attempts,
      0,
    );
  });

  it("stores evidence summary fields and drops a raw response body", async () => {
    const store = repository();
    const created = await store.create({ url: URL });
    const submitted = evidence({ rawBody: "<html>issuer page</html>" });

    const updated = await store.update(created.certificate.id, {
      evidence: submitted,
    });

    assert.deepEqual(updated.evidence, evidence());
    assert.equal(Object.hasOwn(updated.evidence ?? {}, "rawBody"), false);

    submitted.summary = "changed by caller";
    assert.equal(
      (await store.findById(created.certificate.id))?.evidence?.summary,
      "Issuer confirmed the credential.",
    );
  });

  it("leaves immutable identity fields unchanged", async () => {
    const store = repository();
    const created = await store.create({ url: URL });
    const patch = {
      attempts: 1,
      url: "https://evil.example/replaced",
      userId: "someone-else",
      id: "replaced-id",
      submittedAt: "2000-01-01T00:00:00.000Z",
    } as CertificatePatch;

    const updated = await store.update(created.certificate.id, patch);

    assert.equal(updated.id, created.certificate.id);
    assert.equal(updated.userId, LOCAL_DEV_USER_ID);
    assert.equal(updated.url, URL);
    assert.equal(updated.submittedAt, created.certificate.submittedAt);
    assert.equal(updated.attempts, 1);
  });

  it("throws when the certificate does not exist", async () => {
    await assert.rejects(
      () => repository().update("missing", { attempts: 1 }),
      CertificateNotFoundError,
    );
  });

  it("keeps stored certificates unchanged when returned objects are mutated", async () => {
    const store = repository();
    const created = await store.create({
      url: URL,
      issuer: "credly",
      credentialId: "abc123",
    });
    created.certificate.status = "VERIFIED";
    created.certificate.attempts = 9;
    created.certificate.url = "https://evil.example/replaced";

    const found = await store.findById(created.certificate.id);
    assert.ok(found);
    assert.equal(found.status, "PENDING");
    assert.equal(found.attempts, 0);
    assert.equal(found.url, URL);

    found.status = "UNVERIFIED";
    found.attempts = 4;

    const updated = await store.update(created.certificate.id, {
      evidence: evidence(),
    });
    assert.ok(updated.evidence);
    updated.status = "VERIFIED";
    updated.evidence.summary = "mutated summary";
    updated.evidence.holderName = "Changed Name";

    const stored = await store.findById(created.certificate.id);
    assert.ok(stored?.evidence);
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.attempts, 0);
    assert.equal(stored.url, URL);
    assert.equal(stored.evidence.summary, "Issuer confirmed the credential.");
    assert.equal(stored.evidence.holderName, "Ada Lovelace");

    stored.evidence.courseName = "Changed course";
    stored.status = "VERIFIED";
    const reread = await store.findById(created.certificate.id);
    assert.equal(reread?.status, "PENDING");
    assert.equal(reread?.evidence?.courseName, "Systems");
  });

  it("rejects an empty URL before creating a record", async () => {
    const store = repository();

    await assert.rejects(
      () => store.create({ url: "" }),
      InvalidCertificateUpdateError,
    );
    assert.equal(await store.findByUserAndUrl(LOCAL_DEV_USER_ID, ""), null);
  });

  it("rejects invalid evidence and leaves the record unchanged", async () => {
    const store = repository();
    const created = await store.create({ url: URL });

    await assert.rejects(
      () =>
        store.update(created.certificate.id, {
          evidence: { ...evidence(), found: "yes" } as CertificateEvidence,
          attempts: 1,
        }),
      InvalidCertificateUpdateError,
    );

    const stored = await store.findById(created.certificate.id);
    assert.equal(stored?.evidence, null);
    assert.equal(stored?.attempts, 0);
  });

  it("rejects decreasing attempts and leaves the record unchanged", async () => {
    const store = repository();
    const created = await store.create({ url: URL });
    await store.update(created.certificate.id, { attempts: 2 });

    await assert.rejects(
      () => store.update(created.certificate.id, { attempts: 1 }),
      InvalidCertificateUpdateError,
    );
    assert.equal((await store.findById(created.certificate.id))?.attempts, 2);
  });

  it("rejects VERIFIED when a failure reason is present", async () => {
    const store = repository();
    const created = await store.create({ url: URL });

    await assert.rejects(
      () =>
        store.update(created.certificate.id, {
          status: "VERIFIED",
          verifiedAt: DECISION_TIME,
          failureReason: "NOT_FOUND",
        }),
      InvalidCertificateUpdateError,
    );

    const stored = await store.findById(created.certificate.id);
    assert.equal(stored?.status, "PENDING");
    assert.equal(stored?.verifiedAt, null);
    assert.equal(stored?.failureReason, null);
  });

  it("rejects UNVERIFIED without a timestamp or failure reason", async () => {
    const store = repository();
    const created = await store.create({ url: URL });

    await assert.rejects(
      () =>
        store.update(created.certificate.id, {
          status: "UNVERIFIED",
          failureReason: "NOT_FOUND",
        }),
      InvalidCertificateUpdateError,
    );
    await assert.rejects(
      () =>
        store.update(created.certificate.id, {
          status: "UNVERIFIED",
          verifiedAt: DECISION_TIME,
        }),
      InvalidCertificateUpdateError,
    );
    await assert.rejects(
      () =>
        store.update(created.certificate.id, {
          status: "UNVERIFIED",
          verifiedAt: "2026",
          failureReason: "FIELD_MISMATCH",
        }),
      InvalidCertificateUpdateError,
    );

    const stored = await store.findById(created.certificate.id);
    assert.equal(stored?.status, "PENDING");
    assert.equal(stored?.verifiedAt, null);
    assert.equal(stored?.failureReason, null);
    assert.equal(stored?.attempts, 0);
  });

  it("stores a valid ISO 8601 decision time unchanged", async () => {
    const store = repository();
    const created = await store.create({ url: URL });
    const offsetTime = "2026-10-16T13:30:00.000+05:30";

    const verified = await store.update(created.certificate.id, {
      status: "VERIFIED",
      verifiedAt: offsetTime,
    });

    assert.equal(verified.verifiedAt, offsetTime);
    assert.equal(
      (await store.findById(created.certificate.id))?.verifiedAt,
      offsetTime,
    );
  });
});
