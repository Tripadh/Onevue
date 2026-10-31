/**
 * Session policy tests that do not require MongoDB.
 * Database-backed lifecycle tests must use an isolated MongoDB test instance.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};

const { issueSessionCookie, isRefreshRaceWindow, REFRESH_RACE_WINDOW_MS } = require(path.join(projectRoot, "lib", "session.ts"));
const AuthSession = require(path.join(projectRoot, "models", "AuthSession.ts")).default;
const { NextResponse } = require(path.join(projectRoot, "node_modules", "next", "server"));

describe("session cookie lifecycle policy", () => {
  test("declares only one TTL index for session expiration", () => {
    const expiresAtIndexes = AuthSession.schema.indexes().filter(([keys]) => keys.expiresAt === 1);
    assert.equal(expiresAtIndexes.length, 1);
    assert.equal(expiresAtIndexes[0][1].expireAfterSeconds, 0);
  });

  test("sets an HttpOnly refresh cookie and a readable CSRF cookie", () => {
    const response = NextResponse.json({ ok: true });
    issueSessionCookie(response, "refresh-value", "csrf-value");
    const cookies = response.headers.get("set-cookie");
    assert.match(cookies, /onevue_refresh=refresh-value/);
    assert.match(cookies, /onevue_refresh=refresh-value[^;]*; Path=\/api\/auth/);
    assert.match(cookies, /HttpOnly/);
    assert.match(cookies, /onevue_csrf=csrf-value/);
    assert.doesNotMatch(cookies, /onevue_csrf=csrf-value[^;]*HttpOnly/);
    assert.match(cookies, /onevue_csrf=csrf-value.*?Path=\//);
    assert.match(cookies, /onevue_csrf=csrf-value.*?Domain=localhost/);
    assert.match(cookies, /SameSite=lax/i);
  });

  test("refresh rotation does not replace the synchronizer token", () => {
    const response = NextResponse.json({ ok: true });
    issueSessionCookie(response, "rotated-refresh");
    const cookies = response.headers.get("set-cookie");
    assert.match(cookies, /onevue_refresh=rotated-refresh/);
    assert.doesNotMatch(cookies, /onevue_csrf=/);
  });

  test("does not revoke the family during the bounded concurrent-refresh window", () => {
    const now = Date.now();
    assert.equal(isRefreshRaceWindow("same-hash", "same-hash", new Date(now - 1000), now), true);
    assert.equal(isRefreshRaceWindow("same-hash", "same-hash", new Date(now - REFRESH_RACE_WINDOW_MS - 1), now), false);
    assert.equal(isRefreshRaceWindow("other-hash", "same-hash", new Date(now - 1000), now), false);
  });
});
