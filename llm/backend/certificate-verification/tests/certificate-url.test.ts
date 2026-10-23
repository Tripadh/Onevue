import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCertificateUrl,
  UNTRUSTED_CERTIFICATE_URL_MESSAGE,
  type ParsedCertificateUrl,
} from "../src/validation/certificate-url.js";

const CREDENTIAL_ID = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
const URL = `https://www.credly.com/badges/${CREDENTIAL_ID}`;

function accepted(input: string): ParsedCertificateUrl {
  const result = parseCertificateUrl(input);
  assert.equal(result.ok, true, input);
  if (!result.ok) {
    throw new Error(UNTRUSTED_CERTIFICATE_URL_MESSAGE);
  }
  return result.value;
}

function rejected(input: string): void {
  const result = parseCertificateUrl(input);
  assert.deepEqual(result, {
    ok: false,
    error: { path: "url", message: UNTRUSTED_CERTIFICATE_URL_MESSAGE },
  });
}

describe("parseCertificateUrl", () => {
  it("accepts the Credly badge URL and normalizes case", () => {
    const parsed = accepted(URL);
    assert.deepEqual(parsed, {
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
      canonicalUrl: URL,
    });

    const mixedCase = accepted(
      `https://WWW.CREDLY.COM/badges/${CREDENTIAL_ID.toUpperCase()}`,
    );
    assert.equal(mixedCase.credentialId, CREDENTIAL_ID);
    assert.equal(mixedCase.canonicalUrl, URL);
    assert.equal(mixedCase.issuer, "credly");
  });

  it("omits query strings and fragments from the canonical URL", () => {
    for (const input of [
      `${URL}?utm=newsletter`,
      `${URL}#share`,
      `${URL}?utm=1#share`,
    ]) {
      const parsed = accepted(input);
      assert.equal(parsed.canonicalUrl, URL);
      assert.equal(parsed.canonicalUrl.includes("?"), false);
      assert.equal(parsed.canonicalUrl.includes("#"), false);
      assert.equal(parsed.credentialId, CREDENTIAL_ID);
    }
  });

  it("rejects unsafe hosts, ports, paths, and credential IDs", () => {
    const inputs = [
      URL.replace("https://", "http://"),
      `https://www.credly.com./badges/${CREDENTIAL_ID}`,
      `https://www.credly.com%2e/badges/${CREDENTIAL_ID}`,
      `https://www.credly.com@evil.com/badges/${CREDENTIAL_ID}`,
      `https://user:pass@www.credly.com/badges/${CREDENTIAL_ID}`,
      `https://www.credly.com.evil.com/badges/${CREDENTIAL_ID}`,
      `https://notcredly.com/badges/${CREDENTIAL_ID}`,
      `https://www.credly.com:8443/badges/${CREDENTIAL_ID}`,
      `https://www.credly.com:443/badges/${CREDENTIAL_ID}`,
      "not a url",
      `https://www.credly.com/badges/abc123`,
      "https://www.credly.com/badges",
      `${URL}/public_url`,
      `${URL}/extra`,
      `${URL}/`,
      `https://www.credly.com/Badges/${CREDENTIAL_ID}`,
      `https://www.credly.com/badges/%2e%2e/${CREDENTIAL_ID}`,
      `https://www.credly.com/badges/${CREDENTIAL_ID}%2fadmin`,
      `https://www.credly.com/badges/${CREDENTIAL_ID}%2Fadmin`,
      `https://www.credly.com/badges/${CREDENTIAL_ID}%5cadmin`,
      `https://www.credly.com/badges/%`,
      `https://www.credly.com/badges/${CREDENTIAL_ID}%2`,
      `https://www.credly.com/badges/../badges/${CREDENTIAL_ID}`,
      `https://www.credly.com\\badges\\${CREDENTIAL_ID}`,
      "javascript:alert(1)",
    ];

    for (const input of inputs) {
      rejected(input);
    }
  });
});
