const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};

process.env.JWT_SECRET = "unit-test-secret-that-is-at-least-32-chars";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:3000/api/auth/google/callback";

const oauth = require(path.join(projectRoot, "lib", "google-oauth.ts"));

describe("Google OAuth protocol helpers", { concurrency: 1 }, () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const originalCallback = process.env.GOOGLE_CALLBACK_URL;

  after(() => {
    process.env.JWT_SECRET = originalSecret;
    process.env.GOOGLE_CLIENT_ID = originalClientId;
    process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
    process.env.GOOGLE_CALLBACK_URL = originalCallback;
  });

  test("uses S256 PKCE and does not expose the client secret in the authorization URL", () => {
    const verifier = oauth.createCodeVerifier();
    const url = new URL(oauth.createGoogleAuthorizationUrl(oauth.resolveGoogleConfig(), {
      state: "state",
      nonce: "nonce",
      verifier,
    }));

    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), oauth.createCodeChallenge(verifier));
    assert.equal(url.searchParams.get("client_id"), "test-client-id");
    assert.equal(url.searchParams.get("client_secret"), null);
  });

  test("rejects tampered signed state", () => {
    const state = oauth.googleStateFromRequest({});
    const response = { cookies: { set(name, value) { this.name = name; this.value = value; } } };
    oauth.setGoogleStateCookie(response, state);
    const tampered = response.cookies.value.slice(0, -1) + (response.cookies.value.endsWith("A") ? "B" : "A");

    assert.throws(
      () => oauth.getGoogleCallbackState({ cookies: { get: () => ({ value: tampered }) } }),
      /Invalid OAuth state/
    );
  });

  test("fails closed when OAuth configuration is incomplete", () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    assert.throws(() => oauth.resolveGoogleConfig(), /GOOGLE_CLIENT_SECRET/);
    process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
  });
});
