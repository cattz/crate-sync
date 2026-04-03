import { Command } from "commander";
import chalk from "chalk";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { loadConfig } from "../config.js";
import { DownloadService } from "../services/download-service.js";
import { createJob } from "../jobs/runner.js";

export function registerDownloadCommands(program: Command): void {
  const downloads = program
    .command("downloads")
    .description("Manage download files and cleanup");

  downloads
    .command("clean")
    .description("Clean up failed download files and empty folders")
    .option("--failed", "Delete physical files for all failed downloads and clear records")
    .option("--empty-dirs", "Remove empty subdirectories from slskd download dir")
    .action(async (opts: { failed?: boolean; emptyDirs?: boolean }) => {
      if (!opts.failed && !opts.emptyDirs) {
        console.log(chalk.yellow("Specify --failed and/or --empty-dirs"));
        return;
      }

      const db = getDb();
      const config = loadConfig();

      const svc = DownloadService.fromDb(
        db,
        config.soulseek,
        config.download,
        config.lexicon,
        config.matching,
      );

      if (opts.failed) {
        const failedDownloads = db
          .select()
          .from(schema.downloads)
          .where(eq(schema.downloads.status, "failed"))
          .all();

        let deletedFiles = 0;
        let notFound = 0;

        for (const dl of failedDownloads) {
          const filePath = dl.soulseekPath ?? dl.filePath;
          if (!filePath) {
            notFound++;
            continue;
          }

          const resolvedPath = filePath.startsWith("/")
            ? filePath
            : join(config.soulseek.downloadDir, filePath);

          if (existsSync(resolvedPath)) {
            if (svc.deleteDownloadFile(resolvedPath)) {
              deletedFiles++;
            }
          } else {
            notFound++;
          }
        }

        // Clear all failed download records
        const cleared = failedDownloads.length;
        if (cleared > 0) {
          db.delete(schema.downloads)
            .where(eq(schema.downloads.status, "failed"))
            .run();
        }

        console.log(
          chalk.green(`Cleaned ${deletedFiles} file(s), `) +
          chalk.dim(`${notFound} not found on disk, `) +
          chalk.green(`${cleared} record(s) cleared`),
        );
      }

      if (opts.emptyDirs) {
        const removed = svc.cleanupEmptyDirs();
        console.log(
          removed > 0
            ? chalk.green(`Removed ${removed} empty director${removed === 1 ? "y" : "ies"}`)
            : chalk.dim("No empty directories found"),
        );
      }
    });

  downloads
    .command("rescue")
    .description("Rescue orphan downloads from slskd by creating an orphan_rescue job")
    .action(async () => {
      const job = createJob({
        type: "orphan_rescue",
        status: "queued",
        priority: 2,
      });

      console.log(chalk.green(`Orphan rescue job queued: ${job.id}`));
    });
}
