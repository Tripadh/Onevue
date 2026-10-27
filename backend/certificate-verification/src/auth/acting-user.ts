import { timingSafeEqual } from "node:crypto";
import { LOCAL_DEV_USER_ID } from "../db/certificate.js";
import { HttpError } from "../http/error-response.js";

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function headerValue(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

function tokensMatch(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function resolveActingUserId(
  headers: {
    authorization?: string | string[] | undefined;
    "x-onevue-user-id"?: string | string[] | undefined;
  },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.CERTIFICATE_SERVICE_TOKEN?.trim() ?? "";
  if (configured.length === 0) {
    return LOCAL_DEV_USER_ID;
  }

  const authorization = headerValue(headers.authorization);
  const presented = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const matched = tokensMatch(presented, configured);
  const userId = headerValue(headers["x-onevue-user-id"]);
  if (!matched) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      "Service authentication failed.",
    );
  }

  if (!USER_ID_PATTERN.test(userId)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Request validation failed.", [
      { path: "x-onevue-user-id", message: "A valid user id is required." },
    ]);
  }

  return userId;
}
