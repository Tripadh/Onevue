import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchPublishedProfile } from "../src/lib/onevue-api.ts";

describe("OneVue Public Profile API Client", () => {
  it("rejects invalid usernames without making network requests", async () => {
    const invalidUsernames = [
      "",
      "   ",
      "ab", // too short (min 3)
      "this_username_is_way_too_long_to_be_valid_on_onevue_platform", // >30
      "../traversal",
      ".leadingdot", // must start alphanumeric
      "trailingdot.", // must end alphanumeric
      "-leadingdash", // must start alphanumeric
      "trailingdash-", // must end alphanumeric
      "_leadingunderscore",
      "trailingunderscore_",
      "alex/rivera",
      "alex;drop table users;",
      "alex rivera",
      "alex@rivera",
    ];

    for (const u of invalidUsernames) {
      const res = await fetchPublishedProfile(u);
      assert.equal(res.success, false);
      assert.equal(res.notFound, true);
      assert.equal(res.errorMessage, "Invalid username format.");
    }
  });

  it("accepts valid canonical usernames including periods (Phase 3.1 harmonization)", async () => {
    const validUsernamesWithPeriods = [
      "alex.rivera",
      "john.doe",
      "jane.smith.dev",
      "ram.pranai-0104",
      "user_name.test",
    ];

    const originalFetch = globalThis.fetch;
    try {
      const requestedUrls: string[] = [];
      globalThis.fetch = async (url: any) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ success: false, message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      };

      for (const u of validUsernamesWithPeriods) {
        await fetchPublishedProfile(u);
      }

      // Assert that network requests were actually made for usernames with periods
      assert.equal(requestedUrls.length, validUsernamesWithPeriods.length);
      for (let i = 0; i < validUsernamesWithPeriods.length; i++) {
        assert.ok(requestedUrls[i].includes(`/public/profile/${encodeURIComponent(validUsernamesWithPeriods[i])}`));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles 404 response for unknown or unpublished profiles safely", async () => {
    // Mock global fetch
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url: any, init: any) => {
        assert.ok(String(url).includes("/public/profile/unknownuser"));
        assert.equal(init?.cache, "no-store");
        // Must not include any auth headers
        assert.ok(!init?.headers?.Authorization);
        assert.ok(!init?.headers?.Cookie);

        return new Response(
          JSON.stringify({
            success: false,
            message: "Public portfolio was not found or is not currently published.",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await fetchPublishedProfile("unknownuser");
      assert.equal(result.success, false);
      assert.equal(result.notFound, true);
      assert.ok(result.errorMessage?.includes("not found or is not currently published"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles 500 upstream server errors safely without leaking internal details", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return new Response("Internal Server Error", { status: 500 });
      };

      const result = await fetchPublishedProfile("alexrivera");
      assert.equal(result.success, false);
      assert.equal(result.notFound, undefined);
      assert.equal(result.errorMessage, "Upstream service returned status 500.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles network connection failure gracefully", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:3000");
      };

      const result = await fetchPublishedProfile("alexrivera");
      assert.equal(result.success, false);
      assert.ok(result.errorMessage?.includes("Failed to connect to OneVue public API"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("successfully parses valid published profile payload with cache: 'no-store'", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let requestedCache: string | undefined = undefined;
      let requestedUrl = "";

      globalThis.fetch = async (url: any, init: any) => {
        requestedUrl = String(url);
        requestedCache = init?.cache;
        return new Response(
          JSON.stringify({
            success: true,
            dto: {
              meta: { schemaVersion: "1.0.0", username: "alexrivera" },
              profile: { displayName: "Alex Rivera", initials: "AR" },
            },
            website: {
              username: "alexrivera",
              templateId: "magicui-portfolio",
              templateVersion: "1.0.0",
              publishedAt: "2026-10-14T02:50:00.000Z",
              revisionNumber: 1,
              customization: { visibleSections: ["about", "projects"] },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await fetchPublishedProfile("alexrivera");
      assert.equal(result.success, true);
      assert.equal(requestedCache, "no-store");
      assert.ok(requestedUrl.endsWith("/public/profile/alexrivera"));
      assert.equal(result.data?.dto.profile.displayName, "Alex Rivera");
      assert.equal(result.data?.website.username, "alexrivera");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
