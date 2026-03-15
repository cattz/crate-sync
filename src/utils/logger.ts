import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: number = LEVELS.info;
let fileStream: ReturnType<typeof createWriteStream> | null = null;

/** Set the minimum log level */
export function setLogLevel(level: LogLevel): void {
  currentLevel = LEVELS[level];
}

/** Enable file logging (appends to the given path) */
export function setLogFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  fileStream = createWriteStream(path, { flags: "a" });
}

/** Close the log file stream */
export function closeLog(): void {
  fileStream?.end();
  fileStream = null;
}

function write(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < currentLevel) return;

  const ts = new Date().toISOString();
  const prefix = `${ts} [${level.toUpperCase().padEnd(5)}] [${context}]`;
  const line = data
    ? `${prefix} ${message} ${JSON.stringify(data)}`
    : `${prefix} ${message}`;

  if (fileStream) {
    fileStream.write(line + "\n");
  }
}

/** Create a scoped logger for a specific context (e.g. service name) */
export function createLogger(context: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => write("debug", context, msg, data),
    info: (msg: string, data?: Record<string, unknown>) => write("info", context, msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => write("warn", context, msg, data),
    error: (msg: string, data?: Record<string, unknown>) => write("error", context, msg, data),
  };
}
