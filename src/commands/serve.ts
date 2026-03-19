import type { Command } from "commander";
import { startServer } from "../api/server.js";
import { loadConfig } from "../config.js";
import { startJobRunner, stopJobRunner } from "../jobs/runner.js";
import { onShutdown } from "../utils/shutdown.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the web UI API server with job runner")
    .option("-p, --port <port>", "Port to listen on", "3100")
    .option("--no-jobs", "Disable the background job runner")
    .action((opts) => {
      const port = Number(opts.port);
      const config = loadConfig();

      startServer(port);

      if (opts.jobs !== false) {
        startJobRunner(config);
        onShutdown(stopJobRunner);
      }
    });
}
