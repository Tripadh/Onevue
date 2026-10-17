import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { InMemoryCertificateRepository } from "../src/db/in-memory-certificate-repository.js";

const TOKEN = "ownership-test-token";
const BADGE =
  "https://www.credly.com/badges/84e32d3a-b841-4e53-a172-e3e14ffe2bc1";

async function listen(repository = new InMemoryCertificateRepository()) {
  const server: Server = createApp(repository).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP port.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    repository,
  };
}

async function close(server: Server): Promise<void> {
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

describe("certificate ownership", () => {
  const previousToken = process.env.CERTIFICATE_SERVICE_TOKEN;

  before(() => {
    process.env.CERTIFICATE_SERVICE_TOKEN = TOKEN;
  });

  after(() => {
    if (previousToken === undefined) {
      delete process.env.CERTIFICATE_SERVICE_TOKEN;
    } else {
      process.env.CERTIFICATE_SERVICE_TOKEN = previousToken;
    }
  });

  it("rejects a missing service token and hides another user's certificate", async () => {
    const { server, baseUrl } = await listen();
    try {
      const unauthenticated = await fetch(`${baseUrl}/certificates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: BADGE }),
      });
      assert.equal(unauthenticated.status, 401);

      const created = await fetch(`${baseUrl}/certificates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "x-onevue-user-id": "user-a",
        },
        body: JSON.stringify({
          url: BADGE,
          status: "VERIFIED",
          llmStatus: "VERIFIED",
        }),
      });
      assert.equal(created.status, 400);

      const accepted = await fetch(`${baseUrl}/certificates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "x-onevue-user-id": "user-a",
        },
        body: JSON.stringify({ url: BADGE }),
      });
      assert.equal(accepted.status, 202);
      const acceptedBody = (await accepted.json()) as {
        certificate: { id: string; status: string };
      };
      assert.equal(acceptedBody.certificate.status, "PENDING");

      const foreign = await fetch(
        `${baseUrl}/certificates/${acceptedBody.certificate.id}`,
        {
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "x-onevue-user-id": "user-b",
          },
        },
      );
      assert.equal(foreign.status, 404);
      const foreignText = await foreign.text();
      assert.equal(foreignText.includes(acceptedBody.certificate.id), false);

      const own = await fetch(
        `${baseUrl}/certificates/${acceptedBody.certificate.id}`,
        {
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "x-onevue-user-id": "user-a",
          },
        },
      );
      assert.equal(own.status, 200);

      const foreignVerify = await fetch(
        `${baseUrl}/certificates/${acceptedBody.certificate.id}/verify`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${TOKEN}`,
            "x-onevue-user-id": "user-b",
          },
          body: "{}",
        },
      );
      assert.equal(foreignVerify.status, 404);
    } finally {
      await close(server);
    }
  });

  it("rejects an incorrect service token without echoing it", async () => {
    const { server, baseUrl } = await listen();
    try {
      const response = await fetch(`${baseUrl}/certificates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer not-the-service-token",
          "x-onevue-user-id": "user-a",
        },
        body: JSON.stringify({ url: BADGE }),
      });
      const body = (await response.json()) as {
        error: { code: string; message: string };
      };
      assert.equal(response.status, 401);
      assert.equal(body.error.code, "UNAUTHORIZED");
      assert.equal(body.error.message, "Service authentication failed.");
      assert.equal(JSON.stringify(body).includes(TOKEN), false);
      assert.equal(JSON.stringify(body).includes("not-the-service-token"), false);
    } finally {
      await close(server);
    }
  });

  it("ignores a caller-supplied user id when service authentication is not configured", async () => {
    delete process.env.CERTIFICATE_SERVICE_TOKEN;
    const { server, baseUrl } = await listen();
    try {
      const first = await fetch(`${baseUrl}/certificates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-onevue-user-id": "user-a",
        },
        body: JSON.stringify({ url: BADGE }),
      });
      const second = await fetch(`${baseUrl}/certificates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-onevue-user-id": "user-b",
        },
        body: JSON.stringify({ url: `${BADGE}?utm=1` }),
      });
      assert.equal(first.status, 202);
      const firstBody = (await first.json()) as {
        certificate: { id: string };
      };
      const secondBody = (await second.json()) as {
        created: boolean;
        certificate: { id: string };
      };
      assert.equal(second.status, 200);
      assert.equal(secondBody.created, false);
      assert.equal(secondBody.certificate.id, firstBody.certificate.id);
    } finally {
      process.env.CERTIFICATE_SERVICE_TOKEN = TOKEN;
      await close(server);
    }
  });
});
