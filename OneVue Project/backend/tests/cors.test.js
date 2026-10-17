/**
 * CORS allowlist, preflight, and authentication route responses.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return originalResolve.call(this, request, parent, isMain, options);
  } catch (error) {
    if (
      error &&
      error.code === "MODULE_NOT_FOUND" &&
      typeof request === "string" &&
      request.startsWith(".")
    ) {
      return originalResolve.call(this, request + ".ts", parent, isMain, options);
    }
    throw error;
  }
};

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  module._compile(compiled.outputText, filename);
};

const {
  ALLOWED_ORIGINS,
  CORS_ALLOW_HEADERS,
  CORS_ALLOW_METHODS,
  applyCorsHeaders,
  isAllowedOrigin,
  preflightResponse,
} = require(path.join(projectRoot, "lib", "cors.ts"));

const { NextRequest } = require(path.join(projectRoot, "node_modules", "next", "server"));
const { proxy } = require(path.join(projectRoot, "proxy.ts"));
const registerRoute = require(path.join(projectRoot, "app", "api", "auth", "register", "route.ts"));
const loginRoute = require(path.join(projectRoot, "app", "api", "auth", "login", "route.ts"));
const dashboardRoute = require(path.join(projectRoot, "app", "api", "dashboard", "[role]", "route.ts"));

const ALLOWED = "http://127.0.0.1:8080";
const ALLOWED_LOCALHOST = "http://localhost:8080";

function jsonRequest(url, body, origin) {
  const headers = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function assertAllowedCors(response, origin) {
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-methods"), CORS_ALLOW_METHODS);
  assert.equal(response.headers.get("access-control-allow-headers"), CORS_ALLOW_HEADERS);
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
}

describe("CORS allowlist", () => {
  test("allows only the local frontend origins", () => {
    assert.deepEqual(ALLOWED_ORIGINS, [ALLOWED, ALLOWED_LOCALHOST]);
    assert.equal(isAllowedOrigin(ALLOWED), true);
    assert.equal(isAllowedOrigin(ALLOWED_LOCALHOST), true);
  });

  test("rejects other origins, including wildcards and the backend origin", () => {
    for (const origin of [
      null,
      "",
      "*",
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://127.0.0.1:8081",
      "http://localhost:8080.evil.example",
      "https://evil.example",
    ]) {
      assert.equal(isAllowedOrigin(origin), false);
      const response = applyCorsHeaders(new Response(null, { status: 200 }), origin);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
  });

  test("platform config does not publish a wildcard origin", () => {
    const config = fs.readFileSync(path.join(projectRoot, "next.config.ts"), "utf8");
    assert.equal(config.includes('Access-Control-Allow-Origin"'), false);
    assert.equal(config.includes("value: \"*\""), false);
  });
});

describe("preflight", () => {
  test("answers allowed origins with the methods and headers the frontend sends", () => {
    for (const origin of [ALLOWED, ALLOWED_LOCALHOST]) {
      const response = preflightResponse(origin);
      assert.equal(response.status, 204);
      assertAllowedCors(response, origin);
      assert.match(CORS_ALLOW_METHODS, /\bPOST\b/);
      assert.match(CORS_ALLOW_METHODS, /\bGET\b/);
      assert.match(CORS_ALLOW_METHODS, /\bOPTIONS\b/);
      assert.match(CORS_ALLOW_HEADERS, /Content-Type/);
      assert.match(CORS_ALLOW_HEADERS, /Authorization/);
    }
  });

  test("does not reflect a disallowed origin", () => {
    const response = preflightResponse("https://evil.example");
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });

  test("proxy short-circuits API preflight before route handlers", () => {
    const request = new NextRequest("http://localhost:3000/api/auth/register", {
      method: "OPTIONS",
      headers: {
        origin: ALLOWED,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    const response = proxy(request);
    assert.equal(response.status, 204);
    assertAllowedCors(response, ALLOWED);
    assert.equal(response.headers.get("x-middleware-next"), null);
  });

  test("proxy continues non-preflight requests and still attaches CORS", () => {
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        origin: ALLOWED_LOCALHOST,
        "content-type": "application/json",
      },
    });
    const response = proxy(request);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assertAllowedCors(response, ALLOWED_LOCALHOST);
  });

  test("proxy omits CORS for a disallowed origin on an API path", () => {
    const request = new NextRequest("http://localhost:3000/api/student/certificates", {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:9999" },
    });
    const response = proxy(request);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

describe("authentication routes", () => {
  test("register preflight and validation errors keep the response shape and CORS", async () => {
    const preflight = registerRoute.OPTIONS(
      new Request("http://localhost:3000/api/auth/register", {
        method: "OPTIONS",
        headers: { origin: ALLOWED },
      })
    );
    assert.equal(preflight.status, 204);
    assertAllowedCors(preflight, ALLOWED);

    const missing = await registerRoute.POST(
      jsonRequest("http://localhost:3000/api/auth/register", { email: "a@b.c" }, ALLOWED)
    );
    assert.equal(missing.status, 400);
    assertAllowedCors(missing, ALLOWED);
    const missingBody = await missing.json();
    assert.equal(
      missingBody.message,
      "Please provide all required fields (name, email, password)"
    );

    const invalidIdentity = await registerRoute.POST(
      jsonRequest(
        "http://localhost:3000/api/auth/register",
        { name: "Ada", email: "ada@example.com", password: "secret", identity: "admin" },
        ALLOWED_LOCALHOST
      )
    );
    assert.equal(invalidIdentity.status, 400);
    assertAllowedCors(invalidIdentity, ALLOWED_LOCALHOST);
    const identityBody = await invalidIdentity.json();
    assert.match(identityBody.message, /Invalid identity type/);
  });

  test("register error for a disallowed origin does not grant CORS", async () => {
    const response = await registerRoute.POST(
      jsonRequest(
        "http://localhost:3000/api/auth/register",
        {},
        "https://evil.example"
      )
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const body = await response.json();
    assert.equal(
      body.message,
      "Please provide all required fields (name, email, password)"
    );
  });

  test("login preflight and missing credentials keep the existing error", async () => {
    const preflight = loginRoute.OPTIONS(
      new Request("http://localhost:3000/api/auth/login", {
        method: "OPTIONS",
        headers: { origin: ALLOWED_LOCALHOST },
      })
    );
    assert.equal(preflight.status, 204);
    assertAllowedCors(preflight, ALLOWED_LOCALHOST);

    const response = await loginRoute.POST(
      jsonRequest("http://localhost:3000/api/auth/login", { email: "a@b.c" }, ALLOWED)
    );
    assert.equal(response.status, 400);
    assertAllowedCors(response, ALLOWED);
    const body = await response.json();
    assert.equal(body.message, "Please provide both email and password");
  });

  test("dashboard rejection includes CORS for an allowed frontend origin", async () => {
    const response = await dashboardRoute.GET(
      new Request("http://localhost:3000/api/dashboard/not-a-role", {
        headers: { origin: ALLOWED },
      }),
      { params: Promise.resolve({ role: "not-a-role" }) }
    );
    assert.equal(response.status, 400);
    assertAllowedCors(response, ALLOWED);
    const body = await response.json();
    assert.match(body.message, /Invalid dashboard identity/);
  });
});
