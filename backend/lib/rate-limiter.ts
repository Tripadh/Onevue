/**
 * In-Memory Sliding Window Rate Limiter
 * Protects MongoDB Free Tier by rejecting brute-force traffic in-memory
 * without writing ephemeral rate-limit counters to the database.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

// Cleanup stale entries every 10 minutes to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of memoryStore.entries()) {
      if (now > record.resetAt) {
        memoryStore.delete(key);
      }
    }
  }, 10 * 60 * 1000);
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Checks and increments rate limit counter for a given key.
 * @param key Unique key (e.g., `admin_login:${ip}:${email}`)
 * @param maxAttempts Max allowed attempts within window (e.g., 5)
 * @param windowSeconds Window duration in seconds (e.g., 900 for 15 minutes)
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowSeconds: number = 900
): RateLimitResult {
  const now = Date.now();
  const existing = memoryStore.get(key);

  if (!existing || now > existing.resetAt) {
    const record: RateLimitRecord = {
      count: 1,
      resetAt: now + windowSeconds * 1000,
    };
    memoryStore.set(key, record);
    return {
      success: true,
      limit: maxAttempts,
      remaining: maxAttempts - 1,
      resetInSeconds: windowSeconds,
    };
  }

  if (existing.count >= maxAttempts) {
    const resetInSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      success: false,
      limit: maxAttempts,
      remaining: 0,
      resetInSeconds,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, maxAttempts - existing.count);
  const resetInSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  return {
    success: true,
    limit: maxAttempts,
    remaining,
    resetInSeconds,
  };
}

/**
 * Reset rate limit counter on successful authentication
 */
export function resetRateLimit(key: string): void {
  memoryStore.delete(key);
}
