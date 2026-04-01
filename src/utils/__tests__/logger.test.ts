import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock the fs module BEFORE importing the logger,
// because logger.ts imports createWriteStream at the top level.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(),
  };
});

import { createLogger, setLogLevel, setLogFile, closeLog } from "../logger.js";
import { mkdirSync, createWriteStream } from "node:fs";

describe("createLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Reset to default level (info) before each test
    setLogLevel("info");
  });

  afterEach(() => {
    closeLog();
    stderrSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("returns an object with debug, info, warn, and error methods", () => {
    const log = createLogger("test");

    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("writes info messages to stderr", () => {
    const log = createLogger("myctx");
    log.info("hello world");

    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[INFO ]");
    expect(output).toContain("[myctx]");
    expect(output).toContain("hello world");
    expect(output).toMatch(/\n$/);
  });

  it("includes JSON data when provided", () => {
    const log = createLogger("ctx");
    log.info("with data", { key: "value" });

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('{"key":"value"}');
  });

  it("writes error messages to stderr", () => {
    const log = createLogger("err-ctx");
    log.error("something broke");

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[ERROR]");
    expect(output).toContain("something broke");
  });
});

describe("setLogLevel", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    setLogLevel("info");
    stderrSpy.mockRestore();
  });

  it("filters messages below the set level", () => {
    setLogLevel("warn");
    const log = createLogger("test");

    log.debug("should not appear");
    log.info("should not appear either");
    log.warn("should appear");
    log.error("should also appear");

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    const calls = stderrSpy.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("[WARN ]");
    expect(calls[1]).toContain("[ERROR]");
  });

  it("shows debug messages when level is debug", () => {
    setLogLevel("debug");
    const log = createLogger("test");

    log.debug("debug msg");

    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[DEBUG]");
  });

  it("filters everything below error when level is error", () => {
    setLogLevel("error");
    const log = createLogger("test");

    log.debug("no");
    log.info("no");
    log.warn("no");
    log.error("yes");

    expect(stderrSpy).toHaveBeenCalledOnce();
  });
});

describe("setLogFile", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let mockStream: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockStream = { write: vi.fn(), end: vi.fn() };
    vi.mocked(createWriteStream).mockReturnValue(mockStream as any);
    setLogLevel("info");
  });

  afterEach(() => {
    closeLog();
    stderrSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("creates the directory and opens a file stream", () => {
    setLogFile("/tmp/logs/app.log");

    expect(mkdirSync).toHaveBeenCalledWith("/tmp/logs", { recursive: true });
    expect(createWriteStream).toHaveBeenCalledWith("/tmp/logs/app.log", { flags: "a" });
  });

  it("writes log output to the file stream", () => {
    setLogFile("/tmp/logs/app.log");
    const log = createLogger("file-test");

    log.info("file message");

    expect(mockStream.write).toHaveBeenCalledOnce();
    const output = mockStream.write.mock.calls[0][0] as string;
    expect(output).toContain("file message");
  });

  it("writes to both stderr and file stream", () => {
    setLogFile("/tmp/logs/app.log");
    const log = createLogger("both");

    log.warn("dual output");

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(mockStream.write).toHaveBeenCalledOnce();
  });
});

describe("closeLog", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let mockStream: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockStream = { write: vi.fn(), end: vi.fn() };
    vi.mocked(createWriteStream).mockReturnValue(mockStream as any);
    setLogLevel("info");
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("ends the file stream and stops file writing", () => {
    setLogFile("/tmp/logs/app.log");
    closeLog();

    expect(mockStream.end).toHaveBeenCalledOnce();

    // After closing, new log messages should NOT go to the file
    const log = createLogger("after-close");
    log.info("no file");

    expect(stderrSpy).toHaveBeenCalledOnce();
    // write should not have been called after closeLog
    expect(mockStream.write).not.toHaveBeenCalled();
  });

  it("is safe to call when no log file is set", () => {
    expect(() => closeLog()).not.toThrow();
  });
});
