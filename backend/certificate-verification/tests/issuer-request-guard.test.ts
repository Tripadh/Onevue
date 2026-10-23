import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessCredlyUrl,
  assessResolvedAddresses,
  isPublicIpAddress,
  redirectStaysOnCredential,
} from "../src/utils/issuer-request-guard.js";

const CREDENTIAL_ID = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
const URL = `https://www.credly.com/badges/${CREDENTIAL_ID}`;

describe("issuer request guard", () => {
  it("accepts only an allowlisted Credly badge URL", () => {
    const accepted = assessCredlyUrl(`${URL}?utm=1#share`);
    assert.deepEqual(accepted, {
      ok: true,
      target: {
        issuer: "credly",
        credentialId: CREDENTIAL_ID,
        canonicalUrl: URL,
      },
    });

    const rejected = assessCredlyUrl(
      `https://127.0.0.1/badges/${CREDENTIAL_ID}`,
    );
    assert.equal(rejected.ok, false);
  });

  it("treats private, reserved, and ambiguous addresses as unusable", () => {
    const blocked = [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.2.1",
      "192.168.1.20",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "0177.0.0.1",
      "127.1",
      "127.0.0.1:80",
      "localhost",
      "::",
      "::1",
      "[::1]",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      "2001:db8::1",
      "2001:0:0:1::1",
      "2002:7f00:1::",
      "64:ff9b::8.8.8.8",
      "64:ff9b:1::1",
      "100::1",
      "::ffff:127.0.0.1",
      "::ffff:8.8.8.8",
      "0:0:0:0:0:ffff:169.254.169.254",
    ];

    for (const address of blocked) {
      assert.equal(isPublicIpAddress(address), false, address);
    }

    assert.equal(assessResolvedAddresses(["8.8.8.8", "127.0.0.1"]).ok, false);
    assert.equal(assessResolvedAddresses([]).ok, false);
    assert.equal(assessResolvedAddresses(undefined).ok, false);
  });

  it("accepts public addresses", () => {
    for (const address of [
      "1.1.1.1",
      "8.8.8.8",
      "172.15.5.5",
      "172.32.1.1",
      "2606:4700:4700::1111",
    ]) {
      assert.equal(isPublicIpAddress(address), true, address);
    }

    assert.deepEqual(assessResolvedAddresses(["8.8.8.8", "1.1.1.1"]), {
      ok: true,
    });
  });

  it("allows a redirect only when it is the same canonical credential", () => {
    assert.equal(redirectStaysOnCredential(URL, `${URL}?next=1`), true);
    assert.equal(
      redirectStaysOnCredential(
        URL,
        `https://evil.example/badges/${CREDENTIAL_ID}`,
      ),
      false,
    );
    assert.equal(
      redirectStaysOnCredential(
        URL,
        "http://www.credly.com/badges/" + CREDENTIAL_ID,
      ),
      false,
    );
  });
});
