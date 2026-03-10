#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { sql } from "drizzle-orm";
import { registerAuthCommands } from "./commands/auth.js";
import { registerDbCommands } from "./commands/db.js";
import { registerPlaylistCommands } from "./commands/playlists.js";
import { registerLexiconCommands } from "./commands/lexicon.js";
import { registerDownloadCommands } from "./commands/download.js";
import { registerMatchCommands } from "./commands/matches.js";
import { registerSyncCommand } from "./commands/sync.js";
import { loadConfig } from "./config.js";
import { checkHealth } from "./utils/health.js";
import { getDb } from "./db/client.js";
import { playlists, tracks } from "./db/schema.js";

const program = new Command();

program
  .name("crate-sync")
  .description("Manage Spotify playlists and sync them with Lexicon DJ")
  .version("0.1.0");

program
  .command("status")
  .description("Check connectivity to all external services")
  .action(async () => {
    try {
      const config = loadConfig();
      const health = await checkHealth(config);

      // Spotify
      if (health.spotify.ok) {
        console.log(`  Spotify     ${chalk.green("\u2713")} Authenticated`);
      } else {
        console.log(`  Spotify     ${chalk.red("\u2717")} ${health.spotify.error}`);
      }

      // Lexicon
      if (health.lexicon.ok) {
        console.log(`  Lexicon     ${chalk.green("\u2713")} Connected (${config.lexicon.url})`);
      } else {
        console.log(`  Lexicon     ${chalk.red("\u2717")} ${health.lexicon.error}`);
      }

      // Soulseek
      if (health.soulseek.ok) {
        console.log(`  Soulseek    ${chalk.green("\u2713")} Connected (${config.soulseek.slskdUrl})`);
      } else {
        console.log(`  Soulseek    ${chalk.red("\u2717")} ${health.soulseek.error}`);
      }

      // Database
      try {
        const db = getDb();
        const playlistCount = db.select({ count: sql<number>`count(*)` }).from(playlists).get();
        const trackCount = db.select({ count: sql<number>`count(*)` }).from(tracks).get();
        const pCount = playlistCount?.count ?? 0;
        const tCount = trackCount?.count ?? 0;
        console.log(`  Database    ${chalk.green("\u2713")} ${pCount} playlists, ${tCount} tracks`);
      } catch {
        console.log(`  Database    ${chalk.red("\u2717")} Not available`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`Status check failed: ${message}`));
    }
  });

registerAuthCommands(program);
registerDbCommands(program);
registerPlaylistCommands(program);
registerLexiconCommands(program);
registerDownloadCommands(program);
registerMatchCommands(program);
registerSyncCommand(program);

program.parse();
