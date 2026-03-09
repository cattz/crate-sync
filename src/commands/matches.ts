import { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../db/client.js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";

export function registerMatchCommands(program: Command): void {
  const matches = program
    .command("matches")
    .description("Match registry management");

  matches
    .command("list")
    .description("List matches from the database")
    .option("-s, --status <status>", "Filter by status (pending|confirmed|rejected)")
    .action((opts: { status?: string }) => {
      const db = getDb();

      let rows;
      if (opts.status) {
        rows = db
          .select()
          .from(schema.matches)
          .where(eq(schema.matches.status, opts.status as "pending" | "confirmed" | "rejected"))
          .all();
      } else {
        rows = db.select().from(schema.matches).all();
      }

      if (rows.length === 0) {
        console.log(chalk.dim("No matches found."));
        return;
      }

      const idW = 8;
      const srcW = 10;
      const tgtW = 10;
      const scoreW = 6;
      const confW = 8;
      const statusW = 10;
      const methodW = 8;

      console.log(
        chalk.bold(
          `${"ID".padEnd(idW)}  ${"Source".padEnd(srcW)}  ${"Target".padEnd(tgtW)}  ${"Score".padEnd(scoreW)}  ${"Conf".padEnd(confW)}  ${"Status".padEnd(statusW)}  ${"Method".padEnd(methodW)}`,
        ),
      );
      console.log(chalk.dim("─".repeat(idW + srcW + tgtW + scoreW + confW + statusW + methodW + 12)));

      for (const row of rows) {
        const shortId = (row.id ?? "").slice(0, 8);
        const score = row.score.toFixed(2);

        const statusColor =
          row.status === "confirmed"
            ? chalk.green
            : row.status === "rejected"
              ? chalk.red
              : chalk.yellow;

        const confColor =
          row.confidence === "high"
            ? chalk.green
            : row.confidence === "low"
              ? chalk.red
              : chalk.yellow;

        console.log(
          `${chalk.cyan(shortId.padEnd(idW))}  ${row.sourceType.padEnd(srcW)}  ${row.targetType.padEnd(tgtW)}  ${score.padStart(scoreW)}  ${confColor(row.confidence.padEnd(confW))}  ${statusColor(row.status.padEnd(statusW))}  ${chalk.dim(row.method.padEnd(methodW))}`,
        );
      }

      console.log();
      console.log(chalk.dim(`${rows.length} match(es)`));
    });

  matches
    .command("confirm <id>")
    .description("Confirm a match")
    .action((id: string) => {
      const db = getDb();

      // Find matching row by prefix
      const all = db.select().from(schema.matches).all();
      const row = all.find((r) => r.id?.startsWith(id));

      if (!row) {
        console.log(chalk.red(`No match found with ID starting with "${id}".`));
        return;
      }

      db.update(schema.matches)
        .set({ status: "confirmed" })
        .where(eq(schema.matches.id, row.id!))
        .run();

      console.log(chalk.green(`Match ${row.id!.slice(0, 8)} confirmed.`));
    });

  matches
    .command("reject <id>")
    .description("Reject a match")
    .action((id: string) => {
      const db = getDb();

      const all = db.select().from(schema.matches).all();
      const row = all.find((r) => r.id?.startsWith(id));

      if (!row) {
        console.log(chalk.red(`No match found with ID starting with "${id}".`));
        return;
      }

      db.update(schema.matches)
        .set({ status: "rejected" })
        .where(eq(schema.matches.id, row.id!))
        .run();

      console.log(chalk.green(`Match ${row.id!.slice(0, 8)} rejected.`));
    });
}
