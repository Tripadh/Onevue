import {
  createHash,
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { resolveJwtSecret } from "./auth";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const STATE_COOKIE = "onevue_google_oauth";
const STATE_TTL_SECONDS = 10 * 60;

interface GoogleState {
  state: string;
  nonce: string;
  verifier: string;
  linkUserId?: string;
  mac: string;
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string;
  picture?: string;
  emailVerified: true;
}

interface GoogleIdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
  nonce?: unknown;
  exp?: unknown;
  iat?: unknown;
}

interface GoogleJwks {
  keys?: Array<{ kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string }>;
}

let cachedKeys: { expiresAt: number; keys: GoogleJwks } | null = null;

function requiredEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_CALLBACK_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`OAuth configuration is missing ${name}.`);
  return value;
}

export function resolveGoogleConfig() {
  return {
    clientId: requiredEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    callbackUrl: requiredEnv("GOOGLE_CALLBACK_URL"),
  };
}

export function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function encodeState(state: Omit<GoogleState, "mac">): string {
  const encoded = Buffer.from(JSON.stringify(state)).toString("base64url");
  const mac = createHmac("sha256", resolveJwtSecret()).update(encoded).digest("base64url");
  return Buffer.from(JSON.stringify({ ...state, mac })).toString("base64url");
}

function decodeState(value: string): GoogleState {
  let parsed: GoogleState;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as GoogleState;
  } catch {
    throw new Error("Invalid OAuth state.");
  }
  const { mac, ...unsigned } = parsed;
  if (!mac || !unsigned.state || !unsigned.nonce || !unsigned.verifier) throw new Error("Invalid OAuth state.");
  const encoded = Buffer.from(JSON.stringify(unsigned)).toString("base64url");
  const expected = createHmac("sha256", resolveJwtSecret()).update(encoded).digest("base64url");
  const actualBytes = Buffer.from(mac);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error("Invalid OAuth state.");
  }
  return parsed;
}

export function setGoogleStateCookie(response: NextResponse, state: Omit<GoogleState, "mac">): void {
  response.cookies.set(STATE_COOKIE, encodeState(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: STATE_TTL_SECONDS,
  });
}

export function clearGoogleStateCookie(response: NextResponse): void {
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 0,
  });
}

export function readGoogleStateCookie(request: NextRequest): GoogleState {
  const value = request.cookies.get(STATE_COOKIE)?.value;
  if (!value) throw new Error("OAuth state is missing.");
  return decodeState(value);
}

export function createGoogleAuthorizationUrl(
  config: ReturnType<typeof resolveGoogleConfig>,
  state: Omit<GoogleState, "mac">
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state: state.state,
    nonce: state.nonce,
    code_challenge: createCodeChallenge(state.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

async function fetchGoogleKeys(): Promise<GoogleJwks> {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch(GOOGLE_CERTS_ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to retrieve Google signing keys.");
  const keys = (await response.json()) as GoogleJwks;
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] || 300);
  cachedKeys = { keys, expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  return keys;
}

function decodeJwtPart(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
}

export async function exchangeGoogleCode(
  config: ReturnType<typeof resolveGoogleConfig>,
  code: string,
  verifier: string
): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error("Google authorization code exchange failed.");
  const body = (await response.json()) as { id_token?: string };
  if (!body.id_token) throw new Error("Google did not return an ID token.");
  return body.id_token;
}

export async function verifyGoogleIdToken(
  token: string,
  config: ReturnType<typeof resolveGoogleConfig>,
  expectedNonce: string
): Promise<GoogleIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed Google ID token.");
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]) as GoogleIdTokenClaims;
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Unsupported Google ID token.");
  const keys = await fetchGoogleKeys();
  const key = keys.keys?.find((candidate) => candidate.kid === header.kid && candidate.alg === "RS256");
  if (!key || !key.n || !key.e) throw new Error("Unknown Google signing key.");
  const publicKey = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  if (!verifier.verify(publicKey, Buffer.from(parts[2], "base64url"))) throw new Error("Invalid Google ID token signature.");
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(String(claims.iss)) || claims.aud !== config.clientId) throw new Error("Invalid Google ID token issuer or audience.");
  if (typeof claims.exp !== "number" || claims.exp <= now || typeof claims.iat !== "number" || claims.iat > now + 60) throw new Error("Expired or invalid Google ID token.");
  if (claims.nonce !== expectedNonce || typeof claims.sub !== "string" || typeof claims.email !== "string" || claims.email_verified !== true) {
    throw new Error("Google account is not verified.");
  }
  return {
    subject: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : claims.email,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
    emailVerified: true,
  };
}

export function googleStateFromRequest(request: NextRequest, linkUserId?: string) {
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: createCodeVerifier(),
    ...(linkUserId ? { linkUserId } : {}),
  };
}

export function frontendOAuthRedirect(status: "success" | "error", reason?: string): URL {
  const origin = (process.env.CORS_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).find(Boolean) || "http://localhost:8080");
  const url = new URL(origin);
  url.searchParams.set("oauth", status);
  if (reason) url.searchParams.set("reason", reason);
  return url;
}

export function getGoogleCallbackState(request: NextRequest): GoogleState {
  return readGoogleStateCookie(request);
}
