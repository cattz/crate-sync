import { describe, it, expect, vi, beforeEach } from "vitest";

// The shutdown module uses module-level state, so we need to re-import it
// fresh for each test to avoid cross-contamination.
// We use dynamic imports with vi.resetModules() to achieve this.

describe("shutdown", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("isShutdownRequested returns false initially", async () => {
    const { isShutdownRequested } = await import("../shutdown.js");

    expect(isShutdownRequested()).toBe(false);
  });

  it("requestShutdown sets the flag via SIGINT handler", async () => {
    // We cannot easily call requestShutdown directly since the module
    // doesn't export one — the flag is set by the SIGINT handler.
    // Instead, test that setupShutdownHandler registers a SIGINT listener
    // and that emitting SIGINT flips the flag.

    // Mock process.exit to prevent actual exit
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { isShutdownRequested, setupShutdownHandler } = await import("../shutdown.js");

    setupShutdownHandler();

    expect(isShutdownRequested()).toBe(false);

    // Emit SIGINT to trigger the handler
    process.emit("SIGINT");

    // Allow the async handler to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(isShutdownRequested()).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Gracefully shutting down"),
    );

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("shutdown handlers are called on SIGINT", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { onShutdown, setupShutdownHandler } = await import("../shutdown.js");

    const handler1 = vi.fn();
    const handler2 = vi.fn().mockResolvedValue(undefined);

    onShutdown(handler1);
    onShutdown(handler2);

    setupShutdownHandler();

    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 10));

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("cleanup errors during shutdown are silently ignored", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { onShutdown, setupShutdownHandler } = await import("../shutdown.js");

    const failingHandler = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    const goodHandler = vi.fn();

    onShutdown(failingHandler);
    onShutdown(goodHandler);

    setupShutdownHandler();

    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 10));

    // Both handlers should have been called, even though the first threw
    expect(failingHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("second SIGINT force-quits with exit code 1", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { setupShutdownHandler } = await import("../shutdown.js");

    setupShutdownHandler();

    // First SIGINT — graceful
    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 10));

    // Reset to capture second call
    exitSpy.mockClear();

    // Second SIGINT — force quit
    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 10));

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Force quitting"),
    );

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
