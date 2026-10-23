interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function resetAnalyticsRateLimits(): void {
  buckets.clear();
}

export function consumeAnalyticsRateLimit(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const configured = Number(process.env.ANALYTICS_RATE_LIMIT_PER_MINUTE || 60);
  const limit = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 60;
  const windowMs = 60_000;

  if (buckets.size > 5000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
