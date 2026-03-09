import { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../db/client.js";
import { count } from "drizzle-orm";
import * as schema from "../db/schema.js";

export function registerDbCommands(program: Command): void {
  const db = program
    .command("db")
    .description("Local database management");

  db.command("sync")
    .description("Sync Spotify playlists to local DB")
    .action(() => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(
          "Will fetch all playlists and tracks from Spotify and upsert them into the local SQLite database.",
        ),
      );
    });

  db.command("status")
    .description("Show database statistics")
    .action(() => {
      const database = getDb();

      const [playlistCount] = database
        .select({ count: count() })
        .from(schema.playlists)
        .all();
      const [trackCount] = database
        .select({ count: count() })
        .from(schema.tracks)
        .all();
      const [matchCount] = database
        .select({ count: count() })
        .from(schema.matches)
        .all();
      const [downloadCount] = database
        .select({ count: count() })
        .from(schema.downloads)
        .all();

      console.log(chalk.bold("Database Status"));
      console.log();
      console.log(`  Playlists   ${chalk.cyan(String(playlistCount.count).padStart(6))}`);
      console.log(`  Tracks      ${chalk.cyan(String(trackCount.count).padStart(6))}`);
      console.log(`  Matches     ${chalk.cyan(String(matchCount.count).padStart(6))}`);
      console.log(`  Downloads   ${chalk.cyan(String(downloadCount.count).padStart(6))}`);
    });
}
