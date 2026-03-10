let shutdownRequested = false;
const cleanupFns: (() => void | Promise<void>)[] = [];

export function isShutdownRequested(): boolean {
  return shutdownRequested;
}

export function onShutdown(fn: () => void | Promise<void>): void {
  cleanupFns.push(fn);
}

export function setupShutdownHandler(): void {
  process.on("SIGINT", async () => {
    if (shutdownRequested) {
      console.log("\nForce quitting...");
      process.exit(1);
    }
    shutdownRequested = true;
    console.log("\nGracefully shutting down... (press Ctrl+C again to force)");
    for (const fn of cleanupFns) {
      try {
        await fn();
      } catch {
        // Ignore cleanup errors during shutdown
      }
    }
    process.exit(0);
  });
}
