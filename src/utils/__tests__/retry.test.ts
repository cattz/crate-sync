import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, isRetryableError } from "../retry.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const promise = withRetry(fn);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue("recovered");

    const promise = withRetry(fn);

    // Advance through the two retry delays
    await vi.advanceTimersByTimeAsync(20_000);

    const result = await promise;

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after maxRetries exhausted", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });

    // Attach the rejection handler immediately to avoid unhandled rejection
    let caught: Error | undefined;
    const promise = withRetry(fn, { maxRetries: 2 }).catch((e) => {
      caught = e;
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    expect(caught).toBeInstanceOf(TypeError);
    expect(caught!.message).toBe("fetch failed");
    // 1 initial + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects custom retryOn predicate", async () => {
    const customError = new Error("CUSTOM_RETRYABLE");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(customError)
      .mockResolvedValue("ok");

    const retryOn = vi.fn((err: unknown) => {
      return err instanceof Error && err.message === "CUSTOM_RETRYABLE";
    });

    const promise = withRetry(fn, { retryOn });

    await vi.advanceTimersByTimeAsync(20_000);

    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(retryOn).toHaveBeenCalledWith(customError);
  });

  it("does not retry on non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("FATAL: invalid input"));

    const promise = withRetry(fn);

    await expect(promise).rejects.toThrow("FATAL: invalid input");
    // Should only have been called once — no retry for non-retryable errors
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("isRetryableError", () => {
  it("returns true for TypeError (network failures)", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns true for HTTP 429/500/502/503/504 in message", () => {
    expect(isRetryableError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
    expect(isRetryableError(new Error("Status 503"))).toBe(true);
  });

  it("returns true for network error keywords", () => {
    expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("returns false for non-retryable errors", () => {
    expect(isRetryableError(new Error("Invalid argument"))).toBe(false);
    expect(isRetryableError("string error")).toBe(false);
  });
});
