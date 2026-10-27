"use strict";

const crypto = require("crypto");

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Retrieves and validates the centralized JWT secret from process.env.JWT_SECRET.
 * Fails securely when the required secret is missing or invalid (< 32 bytes).
 * Does not silently generate a random secret.
 * Does not log or print the secret value.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== "string" || secret.trim() === "") {
    throw new Error(
      "JWT_SECRET environment variable is missing or empty. A secure secret of at least 32 characters is required."
    );
  }

  const byteLength = Buffer.byteLength(secret, "utf8");
  if (byteLength < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is too short (${byteLength} bytes). A secure secret must be at least 32 bytes.`
    );
  }

  return secret;
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function parseExpiration(expiresIn) {
  if (!expiresIn) return undefined;
  if (typeof expiresIn === "number") {
    return Math.floor(Date.now() / 1000) + expiresIn;
  }
  const match = String(expiresIn).trim().match(/^(\d+)([smhd])?$/);
  if (!match) return undefined;
  const count = parseInt(match[1], 10);
  const unit = match[2] || "s";
  const multipliers = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return Math.floor(Date.now() / 1000) + count * (multipliers[unit] || 1);
}

function fallbackCryptoSign(payload, secret, options) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = parseExpiration(options && options.expiresIn);
  const fullPayload = exp !== undefined ? Object.assign({}, payload, { exp }) : Object.assign({}, payload);
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function fallbackCryptoVerify(token, secret) {
  if (typeof token !== "string") {
    throw new Error("jwt malformed");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("jwt malformed");
  }
  const [encodedHeader, encodedPayload, sig] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error("invalid signature");
  }
  const payloadStr = base64UrlDecode(encodedPayload);
  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    throw new Error("jwt malformed");
  }
  if (payload.exp && typeof payload.exp === "number") {
    if (Math.floor(Date.now() / 1000) > payload.exp) {
      throw new Error("jwt expired");
    }
  }
  return payload;
}

function getJwtLib() {
  try {
    return require("jsonwebtoken");
  } catch {
    return null;
  }
}

/**
 * Sign a JWT token using the centralized JWT_SECRET configuration.
 */
function signJwtToken(payload, options) {
  const secret = getJwtSecret();
  const pkg = getJwtLib();
  const signer =
    (pkg && typeof pkg.sign === "function" && pkg.sign) ||
    (pkg && pkg.default && typeof pkg.default.sign === "function" && pkg.default.sign);

  if (signer) {
    return signer(payload, secret, options);
  }
  return fallbackCryptoSign(payload, secret, options);
}

/**
 * Verify a JWT token using the centralized JWT_SECRET configuration.
 * Optional secret override can be provided for test isolation.
 */
function verifyJwtToken(token, secretOverride) {
  const secret = secretOverride !== undefined ? secretOverride : getJwtSecret();
  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT secret is too short (${secret ? Buffer.byteLength(secret, "utf8") : 0} bytes). A minimum of 32 bytes is required.`
    );
  }

  const pkg = getJwtLib();
  const verifier =
    (pkg && typeof pkg.verify === "function" && pkg.verify) ||
    (pkg && pkg.default && typeof pkg.default.verify === "function" && pkg.default.verify);

  if (verifier) {
    return verifier(token, secret);
  }
  return fallbackCryptoVerify(token, secret);
}

module.exports = {
  MIN_JWT_SECRET_LENGTH,
  getJwtSecret,
  signJwtToken,
  verifyJwtToken,
};
