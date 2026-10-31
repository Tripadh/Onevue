const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("OAuth callback waits for refresh and current-user hydration", async () => {
  let resolveRefresh;
  let session = null;
  const calls = [];
  const window = {
    OV_ENV: {
      API_MODE: "mock",
      API_BASE: "http://localhost:3000/api",
      STORAGE_PREFIX: "onevue:",
    },
    location: {
      hostname: "localhost",
      origin: "http://localhost:8080",
      search: "?oauth=success",
    },
    OV: {
      core: {
        db: {
          get: () => session,
          set: (_key, value) => { session = value; },
          remove: () => { session = null; },
        },
        http: async () => {},
        latency: async () => {},
        uid: () => "test-id",
        isLive: () => false,
        ServiceError: class ServiceError extends Error {},
      },
      services: {},
    },
  };
  const context = {
    window,
    document: { cookie: "onevue_csrf=test-csrf" },
    URL,
    URLSearchParams,
    fetch(url) {
      calls.push(url);
      if (url.endsWith("/auth/refresh")) {
        return new Promise(resolve => {
          resolveRefresh = () => resolve({ ok: true, json: async () => ({ token: "test-access-token" }) });
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          user: {
            id: "user-1",
            name: "Test User",
            email: "test@example.com",
            identity: "student",
            onboarding: { surveyCompleted: false },
          },
        }),
      });
    },
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../services/auth.js"), "utf8"),
    context,
    { filename: "services/auth.js" }
  );

  const restore = window.OV.services.auth.waitForSessionRestore();
  assert.equal(session, null);
  assert.deepEqual(calls, ["http://localhost:3000/api/auth/refresh"]);

  resolveRefresh();
  const restored = await restore;
  assert.equal(restored.user.identity, "student");
  assert.equal(restored.user.onboarding.surveyCompleted, false);
  assert.equal(session.token, "test-access-token");
  assert.deepEqual(calls, [
    "http://localhost:3000/api/auth/refresh",
    "http://localhost:3000/api/auth/me",
  ]);
});
