/**
 * CORS for the platform API. The static frontend is served on port 8080 and
 * calls this backend on port 3000. Only those local origins are reflected.
 */

export const ALLOWED_ORIGINS = [
  "http://127.0.0.1:8080",
  "http://localhost:8080",
] as const;

const ALLOWED_ORIGIN_SET = new Set<string>(ALLOWED_ORIGINS);

export const CORS_ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
export const CORS_ALLOW_HEADERS = "Content-Type, Authorization";

export function isAllowedOrigin(origin: string | null): origin is string {
  return typeof origin === "string" && ALLOWED_ORIGIN_SET.has(origin);
}

export function applyCorsHeaders<T extends Response>(
  response: T,
  origin: string | null
): T {
  if (!isAllowedOrigin(origin)) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  response.headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  response.headers.set("Vary", "Origin");
  return response;
}

export function preflightResponse(origin: string | null): Response {
  return applyCorsHeaders(new Response(null, { status: 204 }), origin);
}
