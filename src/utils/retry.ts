export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
}

/** Check if an error is a transient network/server failure worth retrying. */
export function isRetryableError(error: unknown): boolean {
  // fetch() throws TypeError on network failures (DNS, connection refused, etc.)
  if (error instanceof TypeError) return true;

  if (error instanceof Error) {
    const msg = error.message;
    // HTTP status codes that are transient
    if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
    // Common network error messages
    if (/\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed)\b/i.test(msg)) return true;
  }

  return false;
}

/**
 * Execute an async function with exponential backoff retry logic.
 *
 * Defaults: 3 retries, 1s base delay, 10s max delay, retries on network errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 10000;
  const retryOn = options?.retryOn ?? isRetryableError;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !retryOn(error)) {
        throw error;
      }

      // Exponential backoff with jitter
      const exponentialDelay = baseDelayMs * 2 ** attempt;
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      console.error(
        `[retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${Math.round(delay)}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw lastError;
}
