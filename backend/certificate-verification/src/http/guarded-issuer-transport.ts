import { lookup } from "node:dns/promises";
import https from "node:https";
import { Readable } from "node:stream";
import tls from "node:tls";
import type {
  CredlyTransport,
  CredlyTransportRequest,
  CredlyTransportResult,
} from "../adapters/credly-adapter.js";
import {
  CREDLY_MAX_RESPONSE_BYTES,
  isSupportedIssuerContentType,
} from "../adapters/credly-adapter.js";
import {
  assessCredlyUrl,
  isPublicIpAddress,
} from "../utils/issuer-request-guard.js";
import {
  CREDLY_EVIDENCE_HOSTNAME,
  assessCredlyEvidenceUrl,
} from "../validation/credly-evidence-url.js";

export interface ResolvedSocketAddress {
  address: string;
  family: 4 | 6;
}

export interface HostnameResolver {
  resolve(hostname: string): Promise<readonly ResolvedSocketAddress[]>;
}

export interface PinnedConnectionTarget {
  address: string;
  family: 4 | 6;
  servername: typeof CREDLY_EVIDENCE_HOSTNAME;
  path: string;
  timeoutMs: number;
  maxResponseBytes: number;
  signal: AbortSignal;
}

export interface PinnedResponse {
  statusCode: number;
  headers: NodeJS.Dict<string | string[]>;
  stream: Readable;
}

export interface PinnedConnector {
  connect(target: PinnedConnectionTarget): Promise<PinnedResponse>;
}

export interface GuardedIssuerTransportOptions {
  resolve?: HostnameResolver["resolve"];
  connect?: PinnedConnector["connect"];
}

const JSON_MEDIA_TYPE = "application/json, application/ld+json";

export interface PinnedHttpsOptions extends https.RequestOptions {
  autoSelectFamily: false;
}

export function buildPinnedRequestOptions(
  target: PinnedConnectionTarget,
): PinnedHttpsOptions {
  if (
    target.servername !== CREDLY_EVIDENCE_HOSTNAME ||
    !isPublicIpAddress(target.address) ||
    (target.family === 4 && target.address.includes(":")) ||
    (target.family === 6 && !target.address.includes(":"))
  ) {
    throw new Error("issuer request blocked");
  }

  return {
    protocol: "https:",
    host: target.servername,
    servername: target.servername,
    port: 443,
    method: "GET",
    path: target.path,
    agent: false,
    family: target.family,
    autoSelectFamily: false,
    timeout: target.timeoutMs,
    rejectUnauthorized: true,
    headers: {
      Host: target.servername,
      Accept: JSON_MEDIA_TYPE,
    },
    checkServerIdentity(_hostname, cert) {
      return tls.checkServerIdentity(target.servername, cert);
    },
    lookup(_hostname, _options, callback) {
      callback(null, target.address, target.family);
    },
  };
}

export function createPinnedConnector(
  requestImpl: typeof https.request = https.request,
): PinnedConnector {
  return {
    connect(target) {
      const options = buildPinnedRequestOptions(target);
      return new Promise((resolve, reject) => {
        const request = requestImpl(options, (response) => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            stream: response,
          });
        });
        const abort = () => {
          request.destroy();
          reject(new Error("timeout"));
        };
        if (target.signal.aborted) {
          abort();
          return;
        }
        target.signal.addEventListener("abort", abort, { once: true });
        request.setTimeout(target.timeoutMs, abort);
        request.on("error", () => {
          reject(new Error("connection"));
        });
        request.end();
      });
    },
  };
}

async function defaultResolve(
  hostname: string,
): Promise<readonly ResolvedSocketAddress[]> {
  if (hostname !== CREDLY_EVIDENCE_HOSTNAME) {
    return [];
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
}

function headerValue(
  headers: NodeJS.Dict<string | string[]>,
  name: string,
): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" && first.length > 0 ? first : null;
  }
  return null;
}

function addressMatchesFamily(entry: ResolvedSocketAddress): boolean {
  const ipv4 = !entry.address.includes(":");
  return (entry.family === 4 && ipv4) || (entry.family === 6 && !ipv4);
}

type BodyRead =
  | { type: "body"; body: Buffer }
  | { type: "too_large" }
  | { type: "timeout" }
  | { type: "unavailable" };

function deadline(timeoutMs: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
    },
  };
}

async function readLimited(
  stream: Readable,
  maxBytes: number,
  timeoutMs: number,
): Promise<BodyRead> {
  const chunks: Buffer[] = [];
  let total = 0;
  let stop: "too_large" | "timeout" | null = null;
  const limit = deadline(timeoutMs);
  const signal = limit.signal;
  const abort = () => {
    stop = stop ?? "timeout";
    stream.destroy();
  };
  signal.addEventListener("abort", abort);

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (total + buffer.length > maxBytes) {
        stop = "too_large";
        stream.destroy();
        return { type: "too_large" };
      }
      total += buffer.length;
      chunks.push(buffer);
    }
  } catch {
    if (stop === "too_large") {
      return { type: "too_large" };
    }
    if (stop === "timeout" || signal.aborted) {
      return { type: "timeout" };
    }
    return { type: "unavailable" };
  } finally {
    signal.removeEventListener("abort", abort);
    limit.cancel();
  }

  return { type: "body", body: Buffer.concat(chunks) };
}

function withDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const fail = () => {
      reject(new Error("timeout"));
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", fail);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", fail);
        reject(error instanceof Error ? error : new Error("connection"));
      },
    );
  });
}

export function createGuardedIssuerTransport(
  options: GuardedIssuerTransportOptions = {},
): CredlyTransport {
  const resolve = options.resolve ?? defaultResolve;
  const connect = options.connect ?? createPinnedConnector().connect;

  return {
    resolvesDns: true,
    async exchange(
      request: CredlyTransportRequest,
    ): Promise<CredlyTransportResult> {
      const assessment = assessCredlyUrl(request.canonicalUrl);
      const evidence = assessCredlyEvidenceUrl(
        request.evidenceUrl,
        request.credentialId,
      );
      if (
        !assessment.ok ||
        !evidence.ok ||
        assessment.target.canonicalUrl !== request.canonicalUrl ||
        assessment.target.credentialId !== request.credentialId ||
        evidence.target.hostname !== CREDLY_EVIDENCE_HOSTNAME ||
        (evidence.target.kind === "assertion" &&
          evidence.target.credentialId !== request.credentialId) ||
        request.method !== "GET" ||
        !Number.isFinite(request.timeoutMs) ||
        request.timeoutMs <= 0 ||
        !Number.isInteger(request.maxResponseBytes) ||
        request.maxResponseBytes <= 0 ||
        request.maxResponseBytes > CREDLY_MAX_RESPONSE_BYTES
      ) {
        return { type: "blocked" };
      }

      const path = evidence.target.path;
      let addresses: readonly ResolvedSocketAddress[];
      try {
        addresses = await resolve(CREDLY_EVIDENCE_HOSTNAME);
      } catch {
        return { type: "unavailable" };
      }

      if (
        addresses.length === 0 ||
        addresses.some(
          (entry) =>
            !addressMatchesFamily(entry) || !isPublicIpAddress(entry.address),
        )
      ) {
        return { type: "blocked" };
      }

      const selected = addresses[0];
      if (selected === undefined) {
        return { type: "blocked" };
      }
      const limit = deadline(request.timeoutMs);
      const signal = limit.signal;
      let response: PinnedResponse;
      try {
        response = await withDeadline(
          connect({
            address: selected.address,
            family: selected.family,
            servername: CREDLY_EVIDENCE_HOSTNAME,
            path,
            timeoutMs: request.timeoutMs,
            maxResponseBytes: request.maxResponseBytes,
            signal,
          }),
          signal,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "timeout") {
          return { type: "timeout" };
        }
        if (message === "issuer request blocked") {
          return { type: "blocked" };
        }
        return { type: "unavailable" };
      } finally {
        limit.cancel();
      }

      const status = response.statusCode;
      if (status >= 300 && status < 400) {
        const redirectUrl = headerValue(response.headers, "location");
        response.stream.destroy();
        return {
          type: "response",
          status,
          bodyText: "",
          redirectUrl: redirectUrl ?? undefined,
          contentType: null,
        };
      }

      if (status !== 200) {
        response.stream.destroy();
        return {
          type: "response",
          status,
          bodyText: "",
          contentType: headerValue(response.headers, "content-type"),
        };
      }

      const contentType = headerValue(response.headers, "content-type");
      if (!isSupportedIssuerContentType(contentType)) {
        response.stream.destroy();
        return { type: "unsupported_content" };
      }

      const body = await readLimited(
        response.stream,
        request.maxResponseBytes,
        request.timeoutMs,
      );
      if (body.type === "too_large") {
        return { type: "too_large" };
      }
      if (body.type === "timeout") {
        return { type: "timeout" };
      }
      if (body.type === "unavailable") {
        return { type: "unavailable" };
      }

      return {
        type: "response",
        status: 200,
        bodyText: body.body.toString("utf8"),
        contentType,
      };
    },
  };
}
