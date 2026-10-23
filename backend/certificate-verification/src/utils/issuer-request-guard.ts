import { parseCertificateUrl } from "../validation/certificate-url.js";
import type { IssuerId } from "../validation/issuers.js";

export interface AcceptedIssuerTarget {
  issuer: IssuerId;
  credentialId: string;
  canonicalUrl: string;
}

export type IssuerUrlAssessment =
  { ok: true; target: AcceptedIssuerTarget } | { ok: false; reason: string };

const IPV4_PART = /^(0|[1-9]\d{0,2})$/;

function parseIpv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (const part of parts) {
    if (!IPV4_PART.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    result = result * 256 + octet;
  }

  return result >>> 0;
}

function ipv4InCidr(address: number, base: string, bits: number): boolean {
  const baseValue = parseIpv4(base);
  if (baseValue === null || bits < 0 || bits > 32) {
    return false;
  }

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (baseValue & mask);
}

function isPublicIpv4(address: number): boolean {
  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return !blocked.some(([base, bits]) => ipv4InCidr(address, base, bits));
}

function parseIpv6(value: string): bigint | null {
  let text = value.toLowerCase();
  if (text.includes("%") || text.includes("/")) {
    return null;
  }

  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    if (lastColon === -1) {
      return null;
    }
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) {
      return null;
    }
    const high = ((v4 >>> 16) & 0xffff).toString(16);
    const low = (v4 & 0xffff).toString(16);
    text = `${text.slice(0, lastColon)}:${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }

  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail =
    halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];

  if (halves.length === 1 && head.length !== 8) {
    return null;
  }
  if (head.length + tail.length > 8) {
    return null;
  }

  const missing = 8 - (head.length + tail.length);
  const groups =
    halves.length === 2
      ? [...head, ...Array.from({ length: missing }, () => "0"), ...tail]
      : head;

  if (groups.length !== 8) {
    return null;
  }

  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }
    result = (result << 16n) + BigInt(Number.parseInt(group, 16));
  }

  return result;
}

function prefixEquals(value: bigint, prefix: bigint, bits: number): boolean {
  const shift = 128n - BigInt(bits);
  return value >> shift === prefix >> shift;
}

function isPublicIpv6(value: bigint): boolean {
  if (value === 0n || value === 1n) {
    return false;
  }

  const blocked: Array<[bigint, number]> = [
    [parseIpv6("::ffff:0:0") ?? 0n, 96],
    [parseIpv6("fc00::") ?? 0n, 7],
    [parseIpv6("fe80::") ?? 0n, 10],
    [parseIpv6("fec0::") ?? 0n, 10],
    [parseIpv6("ff00::") ?? 0n, 8],
    [parseIpv6("2001:db8::") ?? 0n, 32],
    [parseIpv6("2001::") ?? 0n, 32],
    [parseIpv6("2002::") ?? 0n, 16],
    [parseIpv6("64:ff9b::") ?? 0n, 96],
    [parseIpv6("64:ff9b:1::") ?? 0n, 48],
    [parseIpv6("100::") ?? 0n, 64],
  ];

  return !blocked.some(([prefix, bits]) => prefixEquals(value, prefix, bits));
}

export function isPublicIpAddress(address: string): boolean {
  const trimmed = address.trim();
  const bare =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;

  if (bare.includes(".")) {
    const ipv4 = parseIpv4(bare);
    return ipv4 !== null && isPublicIpv4(ipv4);
  }

  const ipv6 = parseIpv6(bare);
  return ipv6 !== null && isPublicIpv6(ipv6);
}

export function assessCredlyUrl(url: string): IssuerUrlAssessment {
  const parsed = parseCertificateUrl(url);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "URL is not an accepted Credly badge link.",
    };
  }

  return {
    ok: true,
    target: parsed.value,
  };
}

export function assessResolvedAddresses(
  addresses: readonly string[] | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (addresses === undefined || addresses.length === 0) {
    return {
      ok: false,
      reason: "Outbound requests require resolved public addresses.",
    };
  }

  for (const address of addresses) {
    if (!isPublicIpAddress(address)) {
      return {
        ok: false,
        reason: "Resolved address is private, reserved, or unusable.",
      };
    }
  }

  return { ok: true };
}

export function redirectStaysOnCredential(
  canonicalUrl: string,
  redirectUrl: string,
): boolean {
  const parsed = parseCertificateUrl(redirectUrl);
  return parsed.ok && parsed.value.canonicalUrl === canonicalUrl;
}
