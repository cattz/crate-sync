import type { Command } from "commander";
import { startServer } from "../api/server.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the web UI API server")
    .option("-p, --port <port>", "Port to listen on", "3100")
    .action((opts) => {
      const port = Number(opts.port);
      startServer(port);
    });
}
