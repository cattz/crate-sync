import { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";

export function registerPlaylistCommands(program: Command): void {
  const playlists = program
    .command("playlists")
    .description("Playlist management");

  playlists
    .command("list")
    .description("List playlists from local DB")
    .action(() => {
      const db = getDb();
      const rows = db.select().from(schema.playlists).all();

      if (rows.length === 0) {
        console.log(chalk.dim("No playlists in database. Run `crate-sync db sync` first."));
        return;
      }

      // Header
      const idW = 8;
      const nameW = 40;
      const spotifyW = 24;
      const syncedW = 20;

      console.log(
        chalk.bold(
          `${"ID".padEnd(idW)}  ${"Name".padEnd(nameW)}  ${"Spotify ID".padEnd(spotifyW)}  ${"Last Synced".padEnd(syncedW)}`,
        ),
      );
      console.log(chalk.dim("─".repeat(idW + nameW + spotifyW + syncedW + 6)));

      for (const row of rows) {
        const shortId = (row.id ?? "").slice(0, 8);
        const name = (row.name ?? "").slice(0, nameW);
        const spotifyId = (row.spotifyId ?? "—").slice(0, spotifyW);
        const synced = row.lastSynced
          ? new Date(row.lastSynced).toISOString().slice(0, 16).replace("T", " ")
          : chalk.dim("never");

        console.log(
          `${chalk.cyan(shortId.padEnd(idW))}  ${name.padEnd(nameW)}  ${chalk.dim(spotifyId.padEnd(spotifyW))}  ${synced}`,
        );
      }

      console.log();
      console.log(chalk.dim(`${rows.length} playlist(s)`));
    });

  playlists
    .command("show <id>")
    .description("Show playlist details and tracks")
    .action((id: string) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(`Will show full details and track listing for playlist ${id}.`),
      );
    });

  playlists
    .command("rename <id> <name>")
    .description("Rename a playlist")
    .action((id: string, name: string) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(chalk.dim(`Will rename playlist ${id} to "${name}".`));
    });

  playlists
    .command("merge <ids...>")
    .description("Merge multiple playlists into one")
    .action((ids: string[]) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(`Will merge playlists ${ids.join(", ")} into a single playlist.`),
      );
    });

  playlists
    .command("dupes [id]")
    .description("Find duplicate tracks")
    .action((id?: string) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(
          id
            ? `Will find duplicate tracks in playlist ${id}.`
            : "Will scan all playlists for duplicate tracks.",
        ),
      );
    });

  playlists
    .command("delete <id>")
    .description("Delete a playlist")
    .action((id: string) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(chalk.dim(`Will delete playlist ${id} from the local database.`));
    });
}
