import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import tls from "node:tls";
import { createCredlyAdapter } from "../src/adapters/credly-adapter.js";
import type { CredlyTransportRequest } from "../src/adapters/credly-adapter.js";
import { InMemoryCertificateRepository } from "../src/db/in-memory-certificate-repository.js";
import {
  buildPinnedRequestOptions,
  createGuardedIssuerTransport,
  createPinnedConnector,
  type PinnedConnectionTarget,
  type PinnedResponse,
  type ResolvedSocketAddress,
} from "../src/http/guarded-issuer-transport.js";
import { verifyPendingCertificate } from "../src/services/verify-certificate.js";

const CREDENTIAL_ID = "84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
const URL = `https://www.credly.com/badges/${CREDENTIAL_ID}`;
const DECISION_TIME = "2026-10-16T08:00:00.000Z";

function request(
  overrides: Partial<CredlyTransportRequest> = {},
): CredlyTransportRequest {
  return {
    method: "GET",
    issuer: "credly",
    credentialId: CREDENTIAL_ID,
    canonicalUrl: URL,
    timeoutMs: 50,
    maxResponseBytes: 64,
    ...overrides,
  };
}

function jsonResponse(body: string, statusCode = 200): PinnedResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    stream: Readable.from([Buffer.from(body)]),
  };
}

describe("guarded issuer transport", () => {
  it("connects only to a validated public address for the allowlisted host", async () => {
    const targets: PinnedConnectionTarget[] = [];
    let resolvedHost = "";
    const transport = createGuardedIssuerTransport({
      async resolve(hostname) {
        resolvedHost = hostname;
        return [
          { address: "8.8.8.8", family: 4 },
          { address: "1.1.1.1", family: 4 },
        ];
      },
      async connect(target) {
        targets.push(target);
        return jsonResponse('{"status":"VERIFIED"}');
      },
    });

    const result = await transport.exchange(request());

    assert.equal(resolvedHost, "www.credly.com");
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.address, "8.8.8.8");
    assert.equal(targets[0]?.family, 4);
    assert.equal(targets[0]?.servername, "www.credly.com");
    assert.equal(targets[0]?.path, `/badges/${CREDENTIAL_ID}`);
    assert.deepEqual(result, {
      type: "response",
      status: 200,
      bodyText: '{"status":"VERIFIED"}',
      contentType: "application/json",
    });
  });

  it("does not connect when any resolved address is non-public", async () => {
    const blocked = [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "192.168.0.4",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:8.8.8.8",
    ];

    for (const address of blocked) {
      let connected = false;
      const family = address.includes(":") ? 6 : 4;
      const transport = createGuardedIssuerTransport({
        async resolve() {
          return [{ address, family }];
        },
        async connect() {
          connected = true;
          throw new Error("connected to a blocked address");
        },
      });
      const result = await transport.exchange(request());
      assert.equal(connected, false, address);
      assert.deepEqual(result, { type: "blocked" });
    }

    let mixedConnect = false;
    const mixed = createGuardedIssuerTransport({
      async resolve() {
        return [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ];
      },
      async connect() {
        mixedConnect = true;
        throw new Error("connected");
      },
    });
    assert.deepEqual(await mixed.exchange(request()), { type: "blocked" });
    assert.equal(mixedConnect, false);
  });

  it("accepts a public IPv6 address and rejects a family mismatch", async () => {
    const targets: string[] = [];
    const transport = createGuardedIssuerTransport({
      async resolve() {
        return [{ address: "2606:4700:4700::1111", family: 6 }];
      },
      async connect(target) {
        targets.push(target.address);
        return jsonResponse("{}");
      },
    });
    assert.equal((await transport.exchange(request())).type, "response");
    assert.deepEqual(targets, ["2606:4700:4700::1111"]);

    let mismatched = false;
    const mismatch = createGuardedIssuerTransport({
      async resolve() {
        return [{ address: "8.8.8.8", family: 6 }];
      },
      async connect() {
        mismatched = true;
        throw new Error("connected");
      },
    });
    assert.deepEqual(await mismatch.exchange(request()), { type: "blocked" });
    assert.equal(mismatched, false);
  });

  it("hides DNS and connection failures", async () => {
    const failed = createGuardedIssuerTransport({
      async resolve() {
        throw new Error("getaddrinfo ENOTFOUND secret.internal 10.0.0.5");
      },
      async connect() {
        throw new Error("should not connect");
      },
    });
    const dnsResult = await failed.exchange(request());
    assert.deepEqual(dnsResult, { type: "unavailable" });
    assert.equal(JSON.stringify(dnsResult).includes("secret.internal"), false);
    assert.equal(JSON.stringify(dnsResult).includes("10.0.0.5"), false);

    const refused = createGuardedIssuerTransport({
      async resolve() {
        return [{ address: "8.8.8.8", family: 4 }];
      },
      async connect() {
        throw new Error("connect ECONNREFUSED 8.8.8.8:443 certificate secret");
      },
    });
    const connection = await refused.exchange(request());
    assert.deepEqual(connection, { type: "unavailable" });
    assert.equal(JSON.stringify(connection).includes("8.8.8.8"), false);
    assert.equal(JSON.stringify(connection).includes("secret"), false);
  });

  it("times out a hung connection and a stalled body", async () => {
    const hung = createGuardedIssuerTransport({
      async resolve() {
        return [{ address: "8.8.8.8", family: 4 }];
      },
      connect(target) {
        return new Promise<PinnedResponse>((_resolve, reject) => {
          target.signal.addEventListener(
            "abort",
            () => {
              reject(new Error("timeout"));
            },
            { once: true },
          );
        });
      },
    });
    assert.deepEqual(await hung.exchange(request({ timeoutMs: 20 })), {
      type: "timeout",
    });

    const stalled = createGuardedIssuerTransport({
      async resolve() {
        return [{ address: "8.8.8.8", family: 4 }];
      },
      async connect() {
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          stream: new Readable({
            read() {
              return undefined;
            },
          }),
        };
      },
    });
    assert.deepEqual(await stalled.exchange(request({ timeoutMs: 20 })), {
      type: "timeout",
    });
  });

  it("stops reading once the response exceeds the size limit", async () => {
    const stream = Readable.from([
      Buffer.alloc(40, 0x61),
      Buffer.from("secret-overflow"),
    ]);
    const transport = createGuardedIssuerTransport({
      async resolve() {
        return [{ address: "8.8.8.8", family: 4 }];
      },
      async connect() {
        return {
          statusCode: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          stream,
        };
      },
    });

    const result = await transport.exchange(request({ maxResponseBytes: 40 }));
    assert.deepEqual(result, { type: "too_large" });
    assert.equal(stream.destroyed, true);
    assert.equal(JSON.stringify(result).includes("secret-overflow"), false);
  });

  it("does not follow redirects or keep unsupported bodies", async () => {
    let calls = 0;
    const redirect = createGuardedIssuerTransport({
      async resolve() {
        return [{ address: "8.8.8.8", family: 4 }];
      },
      async connect() {
        calls += 1;
        const stream = Readable.from([Buffer.from("secret-redirect-body")]);
        return {
          statusCode: 302,
          headers: { location: "https://evil.example/private" },
          stream,
        };
      },
    });
    const redirected = await redirect.exchange(request());
    assert.equal(calls, 1);
    assert.equal(redirected.type, "response");
    if (redirected.type === "response") {
      assert.equal(redirected.status, 302);
      assert.equal(redirected.bodyText, "");
      assert.equal(redirected.redirectUrl, "https://evil.example/private");
    }
    assert.equal(
      JSON.stringify(redirected).includes("secret-redirect-body"),
      false,
    );

    const html = createGuardedIssuerTransport({
      async resolve() {
        return [{ address: "8.8.8.8", family: 4 }];
      },
      async connect() {
        return {
          statusCode: 200,
          headers: { "content-type": "text/html" },
          stream: Readable.from([Buffer.from("<html>secret page</html>")]),
        };
      },
    });
    const page = await html.exchange(request());
    assert.deepEqual(page, { type: "unsupported_content" });
    assert.equal(JSON.stringify(page).includes("secret page"), false);
  });

  it("pins the validated address and checks the Credly TLS name", () => {
    const target: PinnedConnectionTarget = {
      address: "8.8.8.8",
      family: 4,
      servername: "www.credly.com",
      path: `/badges/${CREDENTIAL_ID}`,
      timeoutMs: 5000,
      maxResponseBytes: 1024,
      signal: new AbortController().signal,
    };
    const options = buildPinnedRequestOptions(target);

    assert.equal(options.servername, "www.credly.com");
    assert.equal(options.host, "www.credly.com");
    assert.equal(options.path, `/badges/${CREDENTIAL_ID}`);
    assert.equal(options.port, 443);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.autoSelectFamily, false);
    assert.equal(options.agent, false);
    assert.equal(options.family, 4);

    options.lookup?.("www.credly.com", {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, "8.8.8.8");
      assert.equal(family, 4);
    });

    const identity = options.checkServerIdentity?.(
      "8.8.8.8",
      {} as tls.PeerCertificate,
    );
    assert.ok(identity instanceof Error);

    assert.throws(() =>
      buildPinnedRequestOptions({ ...target, address: "127.0.0.1" }),
    );
    assert.throws(() =>
      buildPinnedRequestOptions({
        ...target,
        servername: "evil.example" as "www.credly.com",
      }),
    );
  });

  it("uses the pinned connector lookup instead of resolving again", async () => {
    const seen: Array<string | undefined> = [];
    const connector = createPinnedConnector(((
      options: {
        lookup?: (
          hostname: string,
          lookupOptions: object,
          callback: (
            error: NodeJS.ErrnoException | null,
            address: string,
            family: number,
          ) => void,
        ) => void;
      },
      callback: (
        response: Readable & {
          statusCode?: number;
          headers?: NodeJS.Dict<string>;
        },
      ) => void,
    ) => {
      options.lookup?.("www.credly.com", {}, (_error, address) => {
        seen.push(address);
      });
      const stream = Object.assign(Readable.from([Buffer.from("{}")]), {
        statusCode: 200,
        headers: { "content-type": "application/json" },
      });
      callback(stream);
      return {
        setTimeout() {
          return this;
        },
        on() {
          return this;
        },
        destroy() {
          return this;
        },
        end() {
          return this;
        },
      };
    }) as Parameters<typeof createPinnedConnector>[0]);

    const response = await connector.connect({
      address: "1.1.1.1",
      family: 4,
      servername: "www.credly.com",
      path: `/badges/${CREDENTIAL_ID}`,
      timeoutMs: 1000,
      maxResponseBytes: 100,
      signal: new AbortController().signal,
    });

    assert.deepEqual(seen, ["1.1.1.1"]);
    assert.equal(response.statusCode, 200);
  });
});

describe("guarded Credly verification", () => {
  function addresses(): ResolvedSocketAddress[] {
    return [{ address: "8.8.8.8", family: 4 }];
  }

  it("keeps an unsupported Credly response pending", async () => {
    const store = new InMemoryCertificateRepository();
    const created = await store.create({
      url: URL,
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
    });
    const outcome = await verifyPendingCertificate(
      store,
      createCredlyAdapter({
        permitOutbound: true,
        transport: createGuardedIssuerTransport({
          async resolve() {
            return addresses();
          },
          async connect() {
            return jsonResponse('{"status":"VERIFIED","found":true}');
          },
        }),
      }),
      created.certificate.id,
      { now: () => new Date(DECISION_TIME) },
    );

    assert.equal(outcome.decision.kind, "retryable");
    assert.equal(outcome.certificate.status, "PENDING");
    assert.equal(outcome.certificate.failureReason, null);
    assert.equal(outcome.certificate.verifiedAt, null);
    assert.equal(outcome.certificate.attempts, 1);
    assert.equal(outcome.certificate.evidence, null);
  });

  it("does not verify when DNS returns a private address", async () => {
    let connected = false;
    const store = new InMemoryCertificateRepository();
    const created = await store.create({
      url: URL,
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
    });
    const outcome = await verifyPendingCertificate(
      store,
      createCredlyAdapter({
        permitOutbound: true,
        transport: createGuardedIssuerTransport({
          async resolve() {
            return [{ address: "127.0.0.1", family: 4 }];
          },
          async connect() {
            connected = true;
            throw new Error("connected");
          },
        }),
      }),
      created.certificate.id,
    );

    assert.equal(connected, false);
    assert.equal(outcome.certificate.status, "PENDING");
    assert.equal(outcome.certificate.failureReason, null);
    assert.equal(outcome.decision.kind, "retryable");
  });

  it("does not resolve again after a final status", async () => {
    const store = new InMemoryCertificateRepository();
    const created = await store.create({
      url: URL,
      canonicalUrl: URL,
      issuer: "credly",
      credentialId: CREDENTIAL_ID,
    });
    await store.update(created.certificate.id, {
      status: "VERIFIED",
      verifiedAt: DECISION_TIME,
    });

    let resolved = false;
    const outcome = await verifyPendingCertificate(
      store,
      createCredlyAdapter({
        permitOutbound: true,
        transport: createGuardedIssuerTransport({
          async resolve() {
            resolved = true;
            return addresses();
          },
          async connect() {
            throw new Error("connected");
          },
        }),
      }),
      created.certificate.id,
    );

    assert.equal(resolved, false);
    assert.equal(outcome.decision.kind, "rejected");
    assert.equal(outcome.certificate.status, "VERIFIED");
    assert.equal(outcome.certificate.attempts, 0);
  });
});
