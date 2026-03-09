import { Command } from "commander";
import chalk from "chalk";

export function registerSyncCommand(program: Command): void {
  program
    .command("sync [playlist]")
    .description("Run the full sync pipeline for a playlist")
    .option("--all", "Sync all playlists")
    .option("--dry-run", "Show what would happen without making changes")
    .action((playlist: string | undefined, opts: { all?: boolean; dryRun?: boolean }) => {
      if (!playlist && !opts.all) {
        console.log(chalk.red("Provide a playlist name/ID or use --all."));
        return;
      }

      const target = opts.all ? "all playlists" : `playlist "${playlist}"`;
      const dryLabel = opts.dryRun ? chalk.dim(" (dry run)") : "";

      console.log(chalk.yellow(`⏳ Not yet implemented.`) + dryLabel);
      console.log();
      console.log(chalk.bold(`Sync pipeline for ${target}:`));
      console.log();
      console.log(`  ${chalk.cyan("Phase 1 — Match")}`);
      console.log(
        chalk.dim("    Match Spotify tracks against Lexicon library (ISRC + fuzzy)."),
      );
      console.log(
        chalk.dim("    Auto-accept high-confidence matches, queue the rest for review."),
      );
      console.log();
      console.log(`  ${chalk.cyan("Phase 2 — Download")}`);
      console.log(
        chalk.dim("    For unmatched tracks, search and download from Soulseek."),
      );
      console.log(
        chalk.dim("    Validate format/bitrate, tag files, move to download root."),
      );
      console.log();
      console.log(`  ${chalk.cyan("Phase 3 — Sync")}`);
      console.log(
        chalk.dim("    Create/update the Lexicon playlist with all matched + downloaded tracks."),
      );
      console.log(
        chalk.dim("    Log results to sync_log table."),
      );
    });
}
