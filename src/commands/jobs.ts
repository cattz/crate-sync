import { Command } from "commander";
import chalk from "chalk";
import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";

const statusColor: Record<string, (s: string) => string> = {
  queued: chalk.blue,
  running: chalk.yellow,
  done: chalk.green,
  failed: chalk.red,
};

function formatStatus(status: string): string {
  const colorFn = statusColor[status] ?? chalk.dim;
  return colorFn(status.padEnd(7));
}

function formatTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function registerJobCommands(program: Command): void {
  const jobs = program.command("jobs").description("Manage background jobs");

  // crate-sync jobs list
  jobs
    .command("list")
    .description("List jobs")
    .option("--status <status>", "Filter by status (queued/running/done/failed)")
    .option("--type <type>", "Filter by type (spotify_sync/match/search/download/...)")
    .option("--limit <n>", "Max results", "20")
    .action((opts) => {
      const db = getDb();
      const conditions = [];

      if (opts.status) {
        conditions.push(eq(schema.jobs.status, opts.status as schema.JobStatus));
      }
      if (opts.type) {
        conditions.push(eq(schema.jobs.type, opts.type as schema.JobType));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const limit = Number(opts.limit);

      const rows = db
        .select()
        .from(schema.jobs)
        .where(where)
        .orderBy(desc(schema.jobs.createdAt))
        .limit(limit)
        .all();

      if (rows.length === 0) {
        console.log(chalk.dim("No jobs found."));
        return;
      }

      console.log(
        chalk.dim(
          `${"ID".padEnd(10)} ${"TYPE".padEnd(14)} ${"STATUS".padEnd(9)} ${"ATTEMPT".padEnd(9)} ${"CREATED".padEnd(18)} ERROR`,
        ),
      );

      for (const job of rows) {
        const id = job.id.slice(0, 8);
        const type = job.type.padEnd(14);
        const status = formatStatus(job.status);
        const attempt = `${job.attempt}/${job.maxAttempts}`.padEnd(9);
        const created = formatTime(job.createdAt).padEnd(18);
        const error = job.error ? chalk.dim(job.error.slice(0, 60)) : "";

        console.log(`${id} ${type} ${status} ${attempt} ${created} ${error}`);
      }

      // Show totals
      const stats = db
        .select({
          status: schema.jobs.status,
          count: sql<number>`count(*)`,
        })
        .from(schema.jobs)
        .groupBy(schema.jobs.status)
        .all();

      console.log();
      const parts = stats.map(
        (s) => `${(statusColor[s.status] ?? chalk.dim)(s.status)}: ${s.count}`,
      );
      console.log(chalk.dim("Total: ") + parts.join(chalk.dim(", ")));
    });

  // crate-sync jobs retry <id>
  jobs
    .command("retry <id>")
    .description("Re-queue a failed job")
    .action((id) => {
      const db = getDb();

      // Support short IDs (prefix match)
      const job = db
        .select()
        .from(schema.jobs)
        .where(sql`${schema.jobs.id} LIKE ${id + "%"}`)
        .get();

      if (!job) {
        console.log(chalk.red(`Job not found: ${id}`));
        return;
      }

      if (job.status !== "failed") {
        console.log(chalk.red(`Can only retry failed jobs (current: ${job.status})`));
        return;
      }

      db.update(schema.jobs)
        .set({ status: "queued", error: null, runAfter: null })
        .where(eq(schema.jobs.id, job.id))
        .run();

      console.log(chalk.green(`Re-queued job ${job.id.slice(0, 8)} (${job.type})`));
    });

  // crate-sync jobs retry-all
  jobs
    .command("retry-all")
    .description("Re-queue all failed jobs")
    .option("--type <type>", "Only retry jobs of this type")
    .action((opts) => {
      const db = getDb();
      const conditions = [eq(schema.jobs.status, "failed" as schema.JobStatus)];

      if (opts.type) {
        conditions.push(eq(schema.jobs.type, opts.type as schema.JobType));
      }

      const result = db
        .update(schema.jobs)
        .set({ status: "queued", error: null, runAfter: null })
        .where(and(...conditions))
        .returning()
        .all();

      console.log(chalk.green(`Re-queued ${result.length} failed job(s)`));
    });

  // crate-sync jobs stats
  jobs
    .command("stats")
    .description("Show job statistics")
    .action(() => {
      const db = getDb();

      const byStatus = db
        .select({
          status: schema.jobs.status,
          count: sql<number>`count(*)`,
        })
        .from(schema.jobs)
        .groupBy(schema.jobs.status)
        .all();

      const byType = db
        .select({
          type: schema.jobs.type,
          count: sql<number>`count(*)`,
        })
        .from(schema.jobs)
        .groupBy(schema.jobs.type)
        .all();

      console.log(chalk.bold("By status:"));
      for (const row of byStatus) {
        console.log(`  ${formatStatus(row.status)} ${row.count}`);
      }

      console.log();
      console.log(chalk.bold("By type:"));
      for (const row of byType) {
        console.log(`  ${row.type.padEnd(14)} ${row.count}`);
      }
    });

  // crate-sync wishlist run
  program
    .command("wishlist")
    .description("Manage the wishlist (failed searches for future retry)")
    .command("run")
    .description("Manually trigger a wishlist scan")
    .action(() => {
      const db = getDb();

      // Import and use createJob directly
      const job = db
        .insert(schema.jobs)
        .values({
          type: "wishlist_scan",
          status: "queued",
          priority: -1,
          payload: null,
        })
        .returning()
        .get();

      console.log(chalk.green(`Created wishlist scan job: ${job.id.slice(0, 8)}`));
      console.log(chalk.dim("The job runner will pick it up shortly."));
    });
}
