import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  CREDLY_MAX_RESPONSE_BYTES,
  CREDLY_NETWORK_DISABLED_REASON,
  CREDLY_REDIRECT_REASON,
  CREDLY_REQUEST_TIMEOUT_MS,
  createCredlyAdapter,
  interpretCredlyResponseBody,
  type CredlyTransport,
  type CredlyTransportRequest,
  type CredlyTransportResult,
} from "../src/adapters/credly-adapter.js";
import type { IssuerVerificationResult } from "../src/adapters/issuer-verification-adapter.js";
import { InMemoryCertificateRepository } from "../src/db/in-memory-certificate-repository.js";
import { verifyPendingCertificate } from "../src/services/verify-certificate.js";

const CREDENTIAL_ID = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
const URL = `https://www.credly.com/badges/${CREDENTIAL_ID}`;
const PUBLIC_ADDRESSES = ["8.8.8.8"];

function transport(
  result: CredlyTransportResult | (() => Promise<CredlyTransportResult>),
  requests: CredlyTransportRequest[] = [],
): CredlyTransport {
  return {
    async exchange(request) {
      requests.push(request);
      return typeof result === "function" ? result() : result;
    },
  };
}

function response(
  status: number,
  bodyText: string,
  redirectUrl?: string,
): CredlyTransportResult {
  return {
    type: "response",
    status,
    bodyText,
    ...(redirectUrl === undefined ? {} : { redirectUrl }),
  };
}

describe("Credly adapter contract", () => {
  it("does not contact a transport while outbound retrieval is disabled", async () => {
    let called = false;
    const adapter = createCredlyAdapter({
      transport: {
        async exchange() {
          called = true;
          throw new Error("network was contacted");
        },
      },
    });

    const result = await adapter.verify({
      url: `${URL}?utm=1#share`,
      resolvedAddresses: PUBLIC_ADDRESSES,
    });

    assert.equal(called, false);
    assert.deepEqual(result, {
      kind: "unsupported",
      reason: CREDLY_NETWORK_DISABLED_REASON,
    });
  });

  it("refuses untrusted URLs and unsafe addresses before any request", async () => {
    const requests: CredlyTransportRequest[] = [];
    const adapter = createCredlyAdapter({
      permitOutbound: true,
      transport: transport(response(200, '{"found":true}'), requests),
    });

    const cases: Array<{
      url: string;
      resolvedAddresses?: readonly string[];
    }> = [
      {
        url: "https://evil.example/badges/" + CREDENTIAL_ID,
        resolvedAddresses: PUBLIC_ADDRESSES,
      },
      {
        url: URL.replace("https://", "http://"),
        resolvedAddresses: PUBLIC_ADDRESSES,
      },
      { url: `${URL}/public_url`, resolvedAddresses: PUBLIC_ADDRESSES },
      { url: URL, resolvedAddresses: ["127.0.0.1"] },
      { url: URL, resolvedAddresses: ["10.0.0.8", "8.8.8.8"] },
      { url: URL, resolvedAddresses: ["::ffff:169.254.169.254"] },
      { url: URL },
    ];

    for (const input of cases) {
      const result = await adapter.verify(input);
      assert.equal(result.kind, "unsupported", JSON.stringify(input));
      assert.equal(requests.length, 0, JSON.stringify(input));
    }
  });

  it("asks a guarded transport only for the canonical badge", async () => {
    const requests: CredlyTransportRequest[] = [];
    const adapter = createCredlyAdapter({
      permitOutbound: true,
      transport: transport({ type: "timeout" }, requests),
    });

    const result = await adapter.verify({
      url: `https://WWW.CREDLY.COM/badges/${CREDENTIAL_ID.toUpperCase()}?utm=1#share`,
      resolvedAddresses: PUBLIC_ADDRESSES,
    });

    assert.deepEqual(result, { kind: "timeout" });
    assert.deepEqual(requests, [
      {
        method: "GET",
        issuer: "credly",
        credentialId: CREDENTIAL_ID,
        canonicalUrl: URL,
        evidenceUrl: `https://api.credly.com/v1/obi/v2/badge_assertions/${CREDENTIAL_ID}`,
        timeoutMs: CREDLY_REQUEST_TIMEOUT_MS,
        maxResponseBytes: CREDLY_MAX_RESPONSE_BYTES,
      },
    ]);
  });

  it("maps transport failures without turning them into a credential decision", async () => {
    const cases: Array<[CredlyTransportResult, IssuerVerificationResult]> = [
      [{ type: "timeout" }, { kind: "timeout" }],
      [{ type: "rate_limited" }, { kind: "rate_limited" }],
      [{ type: "unavailable" }, { kind: "issuer_unavailable" }],
      [response(408, ""), { kind: "timeout" }],
      [response(429, '{"message":"slow down"}'), { kind: "rate_limited" }],
      [response(503, "unavailable"), { kind: "issuer_unavailable" }],
      [response(500, "{}"), { kind: "issuer_unavailable" }],
    ];

    for (const [outcome, expected] of cases) {
      const adapter = createCredlyAdapter({
        permitOutbound: true,
        transport: transport(outcome),
      });
      assert.deepEqual(
        await adapter.verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES }),
        expected,
      );
    }
  });

  it("does not treat HTTP success, a badge id, or a generic document as verified", async () => {
    const bodies = [
      '{"status":"VERIFIED","found":true}',
      JSON.stringify({
        "@context": "https://w3id.org/openbadges/v2",
        type: "Assertion",
        id: URL,
        issuedOn: "2026-01-15T00:00:00.000Z",
      }),
      JSON.stringify({ title: "Credly Badge", ok: true }),
      "null",
      "[]",
    ];

    for (const bodyText of bodies) {
      const adapter = createCredlyAdapter({
        permitOutbound: true,
        transport: transport(response(200, bodyText)),
      });
      const result = await adapter.verify({
        url: URL,
        resolvedAddresses: PUBLIC_ADDRESSES,
      });
      assert.equal(result.kind, "unsupported");
      assert.equal(
        JSON.stringify(result).includes('"kind":"confirmed"'),
        false,
      );
      assert.equal(
        JSON.stringify(result).includes('"kind":"not_found"'),
        false,
      );
    }

    const missing = await createCredlyAdapter({
      permitOutbound: true,
      transport: transport(response(404, '{"message":"not found"}')),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.equal(missing.kind, "unsupported");
    assert.equal(missing.kind === "not_found", false);
  });

  it("classifies malformed bodies and refuses redirects", async () => {
    const malformed = [
      response(200, ""),
      response(200, "<html><title>Verified</title></html>"),
      response(200, '{"found":'),
      response(200, "x".repeat(CREDLY_MAX_RESPONSE_BYTES + 1)),
    ];

    for (const outcome of malformed) {
      const adapter = createCredlyAdapter({
        permitOutbound: true,
        transport: transport(outcome),
      });
      const result = await adapter.verify({
        url: URL,
        resolvedAddresses: PUBLIC_ADDRESSES,
      });
      assert.equal(result.kind, "malformed");
    }

    const foreignRedirect = await createCredlyAdapter({
      permitOutbound: true,
      transport: transport(
        response(302, "", `https://evil.example/badges/${CREDENTIAL_ID}`),
      ),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.deepEqual(foreignRedirect, {
      kind: "unsupported",
      reason: "Redirect target failed the Credly URL allowlist.",
    });

    const sameHostRedirect = await createCredlyAdapter({
      permitOutbound: true,
      transport: transport(
        response(
          302,
          "",
          `https://api.credly.com/api/v1/obi/v2/badge_assertions/${CREDENTIAL_ID}`,
        ),
      ),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.deepEqual(sameHostRedirect, {
      kind: "unsupported",
      reason: CREDLY_REDIRECT_REASON,
    });
  });

  it("interprets a body without promoting it to confirmed evidence", () => {
    assert.equal(
      interpretCredlyResponseBody('{"status":"VERIFIED"}').kind,
      "unsupported",
    );
    assert.equal(interpretCredlyResponseBody("<html>").kind, "malformed");
    assert.equal(interpretCredlyResponseBody("").kind, "malformed");
  });
});

const ORG_ID = "7b741b5c-231d-4925-8041-c64b6846f1c8";
const CLASS_ID = "614ce649-5d1e-4a98-81e4-f24b727dbeb9";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const EARNER_EMAIL = "ada@example.com";
const EARNER_HASH = createHash("sha256")
  .update(EARNER_EMAIL, "utf8")
  .digest("hex");
const NOW = new Date("2026-06-01T00:00:00.000Z");

function assertionBody(
  credentialId = CREDENTIAL_ID,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    "@context": "https://w3id.org/openbadges/v2",
    type: "Assertion",
    id: `https://api.credly.com/api/v1/obi/v2/badge_assertions/${credentialId}`,
    badge: `https://api.credly.com/api/v1/obi/v2/issuers/${ORG_ID}/badge_classes/${CLASS_ID}`,
    issuedOn: "2024-12-20T00:00:00.000Z",
    expires: "2027-12-20T00:00:00.000Z",
    recipient: {
      type: "email",
      hashed: true,
      identity: `sha256$${EARNER_HASH}`,
    },
    verification: { type: "hosted" },
    ...overrides,
  });
}

function badgeClassBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    "@context": "https://w3id.org/openbadges/v2",
    type: "BadgeClass",
    id: `https://api.credly.com/api/v1/obi/v2/issuers/${ORG_ID}/badge_classes/${CLASS_ID}`,
    name: "Systems",
    issuer: {
      "@context": "https://w3id.org/openbadges/v2",
      type: "Profile",
      id: `https://api.credly.com/api/v1/obi/v2/issuers/${ORG_ID}`,
      name: "Example Issuer",
      email: "issuer@example.com",
    },
    ...overrides,
  });
}

function scriptedTransport(
  handler: (request: CredlyTransportRequest) => CredlyTransportResult,
  requests: CredlyTransportRequest[] = [],
): CredlyTransport {
  return {
    resolvesDns: true,
    async exchange(request) {
      requests.push(request);
      return handler(request);
    },
  };
}

describe("Credly Open Badges evidence", () => {
  it("confirms a hosted assertion only after the badge class and issuer match", async () => {
    const requests: CredlyTransportRequest[] = [];
    const logs: Array<{ outcome: string; credentialId: string }> = [];
    const adapter = createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      logger(event) {
        logs.push(event);
      },
      transport: scriptedTransport((request) => {
        if (request.evidenceUrl.includes("/badge_assertions/")) {
          return response(200, assertionBody());
        }
        return response(200, badgeClassBody());
      }, requests),
    });

    const result = await adapter.verify({
      url: URL,
      resolvedAddresses: PUBLIC_ADDRESSES,
      expectedRecipientEmail: EARNER_EMAIL,
    });

    assert.equal(result.kind, "confirmed");
    if (result.kind !== "confirmed") {
      return;
    }
    assert.equal(result.evidence.credentialId, CREDENTIAL_ID);
    assert.equal(result.evidence.courseName, "Systems");
    assert.equal(result.evidence.issuedDate, "2024-12-20");
    assert.equal(result.evidence.holderName, "");
    assert.equal(result.evidence.recipientDisclosed, false);
    assert.equal(result.evidence.recipientMatch, "matched");
    assert.equal(result.evidence.recipientMatch, "matched");
    assert.equal(result.evidence.issuerName, "Example Issuer");
    assert.equal(JSON.stringify(result).includes(EARNER_EMAIL), false);
    assert.equal(JSON.stringify(result).includes(EARNER_HASH), false);
    assert.equal(JSON.stringify(result).includes("issuer@example.com"), false);
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.evidenceUrl,
      `https://api.credly.com/v1/obi/v2/badge_assertions/${CREDENTIAL_ID}`,
    );
    assert.equal(requests[1]?.evidenceUrl.includes("/badge_classes/"), true);
    assert.deepEqual(logs, [
      {
        event: "credly_verification",
        outcome: "confirmed",
        credentialId: CREDENTIAL_ID,
      },
    ]);

    const store = new InMemoryCertificateRepository();
    const created = await store.create({
      url: URL,
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
    });
    const outcome = await verifyPendingCertificate(
      store,
      adapter,
      created.certificate.id,
      { now: () => NOW, earnerEmail: EARNER_EMAIL },
    );
    assert.equal(outcome.certificate.status, "VERIFIED");
    assert.equal(outcome.certificate.recipientMatch, "matched");
    assert.equal(outcome.certificate.evidence?.holderName, null);
    assert.equal(outcome.certificate.evidence?.courseName, "Systems");
    assert.equal(
      JSON.stringify(outcome.certificate).includes(EARNER_EMAIL),
      false,
    );
  });

  it("does not confirm a different badge id, recipient, issuer, expiry, or revocation", async () => {
    const cases: Array<{
      label: string;
      assertion?: string;
      badgeClass?: string;
      email?: string;
      status?: number;
      expect: string;
    }> = [
      {
        label: "other badge",
        assertion: assertionBody(OTHER_ID),
        expect: "confirmed-other",
      },
      {
        label: "recipient",
        email: "other@example.com",
        expect: "mismatched",
      },
      {
        label: "expired",
        assertion: assertionBody(CREDENTIAL_ID, {
          expires: "2020-01-01T00:00:00.000Z",
        }),
        expect: "EXPIRED",
      },
      {
        label: "revoked",
        assertion: assertionBody(CREDENTIAL_ID, { revoked: true }),
        expect: "REVOKED",
      },
      {
        label: "issuer",
        badgeClass: badgeClassBody({
          issuer: {
            "@context": "https://w3id.org/openbadges/v2",
            type: "Profile",
            id: `https://api.credly.com/api/v1/obi/v2/issuers/${OTHER_ID}`,
            name: "Wrong Issuer",
          },
        }),
        expect: "unsupported",
      },
    ];

    for (const testCase of cases) {
      const requests: CredlyTransportRequest[] = [];
      const adapter = createCredlyAdapter({
        permitOutbound: true,
        now: () => NOW,
        transport: scriptedTransport((request) => {
          if (testCase.status !== undefined) {
            return response(testCase.status, "");
          }
          if (request.evidenceUrl.includes("/badge_assertions/")) {
            return response(200, testCase.assertion ?? assertionBody());
          }
          return response(200, testCase.badgeClass ?? badgeClassBody());
        }, requests),
      });
      const result = await adapter.verify({
        url: URL,
        resolvedAddresses: PUBLIC_ADDRESSES,
        ...(testCase.email === undefined
          ? {}
          : { expectedRecipientEmail: testCase.email }),
      });
      if (testCase.expect === "confirmed-other") {
        assert.equal(result.kind, "confirmed", testCase.label);
        if (result.kind === "confirmed") {
          assert.equal(result.evidence.credentialId, OTHER_ID);
          assert.notEqual(result.evidence.credentialId, CREDENTIAL_ID);
        }
      } else if (testCase.expect === "mismatched") {
        assert.equal(result.kind, "confirmed", testCase.label);
        if (result.kind === "confirmed") {
          assert.equal(result.evidence.recipientMatch, "mismatched");
          assert.equal(result.evidence.credentialId, CREDENTIAL_ID);
        }
        assert.equal(JSON.stringify(result).includes(EARNER_EMAIL), false);
        assert.equal(JSON.stringify(result).includes(EARNER_HASH), false);
      } else if (
        testCase.expect === "EXPIRED" ||
        testCase.expect === "REVOKED"
      ) {
        assert.equal(result.kind, "rejected_evidence", testCase.label);
        if (result.kind === "rejected_evidence") {
          assert.equal(result.evidence.failure, testCase.expect);
        }
        assert.equal(JSON.stringify(result).includes(EARNER_EMAIL), false);
        assert.equal(JSON.stringify(result).includes(EARNER_HASH), false);
      } else {
        assert.equal(result.kind, "unsupported", testCase.label);
        assert.equal(result.kind === "confirmed", false);
      }
      assert.equal(
        requests.some((request) =>
          request.evidenceUrl.includes("evil.example"),
        ),
        false,
        testCase.label,
      );
    }

    const revoked = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: transport(response(410, "")),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.equal(revoked.kind, "rejected_evidence");
    if (revoked.kind === "rejected_evidence") {
      assert.equal(revoked.evidence.failure, "REVOKED");
    }

    const unavailable = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: transport(response(401, "")),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.deepEqual(unavailable, { kind: "issuer_unavailable" });
  });

  it("does not follow redirects or fetch a badge class outside the allowlist", async () => {
    const requests: CredlyTransportRequest[] = [];
    const redirected = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: scriptedTransport(
        () => response(302, assertionBody(), "https://evil.example/secret"),
        requests,
      ),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.equal(redirected.kind, "unsupported");
    assert.equal(requests.length, 1);

    const foreignClassRequests: CredlyTransportRequest[] = [];
    const foreignClass = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: scriptedTransport(
        () =>
          response(
            200,
            assertionBody(CREDENTIAL_ID, {
              badge: "https://evil.example/badge-class",
            }),
          ),
        foreignClassRequests,
      ),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.equal(foreignClass.kind, "unsupported");
    assert.equal(foreignClassRequests.length, 1);

    const timedOut = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: scriptedTransport((request) =>
        request.evidenceUrl.includes("/badge_assertions/")
          ? response(200, assertionBody())
          : { type: "timeout" },
      ),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.deepEqual(timedOut, { kind: "timeout" });

    const malformedClass = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: scriptedTransport((request) =>
        request.evidenceUrl.includes("/badge_assertions/")
          ? response(200, assertionBody())
          : response(200, "{"),
      ),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.equal(malformedClass.kind, "malformed");
  });

  it("keeps a missing email unchecked and binds only a later matching hash", async () => {
    const requests: CredlyTransportRequest[] = [];
    const adapter = createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: scriptedTransport((request) => {
        if (request.evidenceUrl.includes("/badge_assertions/")) {
          return response(200, assertionBody());
        }
        return response(200, badgeClassBody());
      }, requests),
    });
    const store = new InMemoryCertificateRepository();
    const created = await store.create({
      url: URL,
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
    });
    const unchecked = await verifyPendingCertificate(
      store,
      adapter,
      created.certificate.id,
      { now: () => NOW, userId: created.certificate.userId },
    );
    assert.equal(unchecked.certificate.status, "VERIFIED");
    assert.equal(unchecked.certificate.recipientMatch, "unchecked");
    assert.equal(unchecked.certificate.verifiedAt, NOW.toISOString());

    const mismatched = await verifyPendingCertificate(
      store,
      adapter,
      created.certificate.id,
      {
        now: () => NOW,
        userId: created.certificate.userId,
        earnerEmail: "other@example.com",
      },
    );
    assert.equal(mismatched.certificate.status, "VERIFIED");
    assert.equal(mismatched.certificate.recipientMatch, "mismatched");
    assert.equal(mismatched.certificate.verifiedAt, NOW.toISOString());

    const matched = await verifyPendingCertificate(
      store,
      adapter,
      created.certificate.id,
      {
        now: () => NOW,
        userId: created.certificate.userId,
        earnerEmail: EARNER_EMAIL,
      },
    );
    assert.equal(matched.certificate.status, "VERIFIED");
    assert.equal(matched.certificate.recipientMatch, "matched");
    assert.equal(JSON.stringify(matched.certificate).includes(EARNER_EMAIL), false);

    const stillMatched = await verifyPendingCertificate(
      store,
      adapter,
      created.certificate.id,
      {
        now: () => NOW,
        userId: created.certificate.userId,
        earnerEmail: "other@example.com",
      },
    );
    assert.equal(stillMatched.certificate.recipientMatch, "matched");
    assert.equal(stillMatched.certificate.status, "VERIFIED");

    const outage = await verifyPendingCertificate(
      store,
      createCredlyAdapter({
        permitOutbound: true,
        now: () => NOW,
        transport: scriptedTransport(() => ({ type: "timeout" })),
      }),
      created.certificate.id,
      {
        now: () => NOW,
        userId: created.certificate.userId,
        earnerEmail: EARNER_EMAIL,
      },
    );
    assert.equal(outage.certificate.status, "VERIFIED");
    assert.equal(outage.certificate.recipientMatch, "matched");
    assert.equal(outage.certificate.attempts, matched.certificate.attempts);
  });

  it("uses the Open Badges salt concatenation and rejects a malformed recipient", async () => {
    const salt = "nacl";
    const salted = createHash("sha256")
      .update(`${EARNER_EMAIL}${salt}`, "utf8")
      .digest("hex");
    const saltedBody = assertionBody(CREDENTIAL_ID, {
      recipient: {
        type: "email",
        hashed: true,
        salt,
        identity: `sha256$${salted}`,
      },
    });
    const matched = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: scriptedTransport((request) =>
        request.evidenceUrl.includes("/badge_assertions/")
          ? response(200, saltedBody)
          : response(200, badgeClassBody()),
      ),
    }).verify({
      url: URL,
      resolvedAddresses: PUBLIC_ADDRESSES,
      expectedRecipientEmail: EARNER_EMAIL,
    });
    assert.equal(matched.kind, "confirmed");
    if (matched.kind === "confirmed") {
      assert.equal(matched.evidence.recipientMatch, "matched");
    }

    const differentCase = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: scriptedTransport((request) =>
        request.evidenceUrl.includes("/badge_assertions/")
          ? response(200, assertionBody())
          : response(200, badgeClassBody()),
      ),
    }).verify({
      url: URL,
      resolvedAddresses: PUBLIC_ADDRESSES,
      expectedRecipientEmail: "Ada@example.com",
    });
    assert.equal(differentCase.kind, "confirmed");
    if (differentCase.kind === "confirmed") {
      assert.equal(differentCase.evidence.recipientMatch, "mismatched");
    }

    const malformedRecipient = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: transport(
        response(
          200,
          assertionBody(CREDENTIAL_ID, {
            recipient: { type: "email", hashed: true, identity: "sha256$not-a-hash" },
          }),
        ),
      ),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.equal(malformedRecipient.kind, "malformed");

    const missingRecipient = await createCredlyAdapter({
      permitOutbound: true,
      now: () => NOW,
      transport: transport(
        response(200, assertionBody(CREDENTIAL_ID, { recipient: undefined })),
      ),
    }).verify({ url: URL, resolvedAddresses: PUBLIC_ADDRESSES });
    assert.equal(missingRecipient.kind, "malformed");
    assert.notEqual(missingRecipient.kind, "confirmed");
  });
});
