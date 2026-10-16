import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CREDLY_EVIDENCE_UNSUPPORTED_REASON,
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
      assert.deepEqual(result, {
        kind: "unsupported",
        reason: CREDLY_EVIDENCE_UNSUPPORTED_REASON,
      });
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
      transport: transport(response(302, "", `${URL}?next=1`)),
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
