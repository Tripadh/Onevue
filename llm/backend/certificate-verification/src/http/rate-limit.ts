import type { Request, RequestHandler } from "express";
import { HttpError } from "./error-response.js";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const SUBMISSION_RATE_LIMIT: RateLimitRule = {
  limit: 30,
  windowMs: 60_000,
};

export const VERIFICATION_RATE_LIMIT: RateLimitRule = {
  limit: 20,
  windowMs: 60_000,
};

const MAX_TRACKED_PEERS = 1024;

interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

function consume(
  buckets: Map<string, number[]>,
  key: string,
  rule: RateLimitRule,
  now: number,
): RateLimitDecision {
  const cutoff = now - rule.windowMs;
  const recent = (buckets.get(key) ?? []).filter((stamp) => stamp > cutoff);
  if (recent.length >= rule.limit) {
    buckets.set(key, recent);
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + rule.windowMs - now) / 1000),
      ),
    };
  }

  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > MAX_TRACKED_PEERS) {
    for (const [peer, stamps] of buckets) {
      const active = stamps.filter((stamp) => stamp > cutoff);
      if (active.length === 0) {
        buckets.delete(peer);
      } else if (active.length !== stamps.length) {
        buckets.set(peer, active);
      }
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

function peerKey(req: Request): string {
  return req.socket.remoteAddress ?? "unknown";
}

export function createRateLimiter(
  rule: RateLimitRule,
  now: () => number,
  matches: (req: Request) => boolean,
): RequestHandler {
  const buckets = new Map<string, number[]>();

  return (req, res, next) => {
    if (!matches(req)) {
      next();
      return;
    }

    const decision = consume(buckets, peerKey(req), rule, now());
    if (decision.allowed) {
      next();
      return;
    }

    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    next(
      new HttpError(429, "RATE_LIMITED", "Too many requests. Try again later."),
    );
  };
}

export function isSubmissionRequest(req: Request): boolean {
  return req.method === "POST" && req.path === "/certificates";
}

export function isVerificationRequest(req: Request): boolean {
  return (
    req.method === "POST" && /^\/certificates\/[^/]+\/verify$/.test(req.path)
  );
}
