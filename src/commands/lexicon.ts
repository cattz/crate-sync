import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { getDb } from "../db/client.js";
import { LexiconService } from "../services/lexicon-service.js";
import { PlaylistService } from "../services/playlist-service.js";
import { SyncPipeline } from "../services/sync-pipeline.js";
import { checkHealth } from "../utils/health.js";

export function registerLexiconCommands(program: Command): void {
  const lexicon = program
    .command("lexicon")
    .description("Lexicon DJ integration");

  lexicon
    .command("status")
    .description("Test Lexicon connection")
    .action(async () => {
      try {
        const config = loadConfig();
        const service = new LexiconService(config.lexicon);

        console.log(chalk.dim(`Connecting to ${config.lexicon.url}...`));

        const ok = await service.ping();

        if (ok) {
          console.log(chalk.green("Lexicon is reachable."));
        } else {
          console.log(chalk.red("Could not connect to Lexicon."));
          console.log(chalk.dim(`Check that Lexicon is running at ${config.lexicon.url}`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Connection failed: ${message}`));
      }
    });

  lexicon
    .command("match <playlist>")
    .description("Match playlist tracks against Lexicon library")
    .action(async (playlist: string) => {
      try {
        const config = loadConfig();

        // Check Lexicon reachability before matching
        const health = await checkHealth(config);
        if (!health.lexicon.ok) {
          console.log(chalk.red(`Lexicon not available \u2014 ${health.lexicon.error}`));
          return;
        }

        const db = getDb();
        const playlistService = new PlaylistService(db);

        // Resolve playlist by ID, spotify ID, or name
        let resolved = playlistService.getPlaylist(playlist);
        if (!resolved) {
          const all = playlistService.getPlaylists();
          resolved = all.find(
            (p) => p.name.toLowerCase() === playlist.toLowerCase(),
          ) ?? null;
        }

        if (!resolved) {
          console.log(chalk.red(`Playlist not found: "${playlist}"`));
          console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
          return;
        }

        console.log(chalk.bold(`Matching "${resolved.name}" against Lexicon library...`));
        console.log();

        const pipeline = new SyncPipeline(config);
        const result = await pipeline.matchPlaylist(resolved.id);

        console.log(chalk.bold("Match results"));
        console.log();
        console.log(`  Total tracks    ${chalk.cyan(String(result.total))}`);
        console.log(`  Confirmed       ${chalk.green(String(result.confirmed.length))}`);
        console.log(`  Pending review  ${chalk.yellow(String(result.pending.length))}`);
        console.log(`  Not found       ${chalk.red(String(result.notFound.length))}`);

        if (result.pending.length > 0) {
          console.log();
          console.log(chalk.bold("Pending review:"));
          for (const item of result.pending) {
            const score = (item.score * 100).toFixed(0);
            console.log(
              `  ${chalk.yellow(`${score}%`)}  ${item.track.title} \u2014 ${chalk.dim(item.track.artist)}`,
            );
          }
        }

        if (result.notFound.length > 0) {
          console.log();
          console.log(chalk.bold("Not found:"));
          for (const item of result.notFound) {
            console.log(
              `  ${chalk.red("x")}  ${item.track.title} \u2014 ${chalk.dim(item.track.artist)}`,
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Match failed: ${message}`));
      }
    });
}
