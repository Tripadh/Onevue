import { LOCAL_DEV_USER_ID } from "./certificate.js";
import { InvalidCertificateUpdateError } from "./certificate-repository.js";

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function actingUserId(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    return LOCAL_DEV_USER_ID;
  }

  const userId = value.trim();
  if (!USER_ID_PATTERN.test(userId)) {
    throw new InvalidCertificateUpdateError("userId is invalid.");
  }

  return userId;
}
