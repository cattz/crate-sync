import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { SoulseekService } from "../services/soulseek-service.js";

export function registerDownloadCommands(program: Command): void {
  const download = program
    .command("download")
    .description("Download tracks via Soulseek");

  download
    .command("search <query>")
    .description("Search Soulseek for a track")
    .action(async (query: string) => {
      try {
        const config = loadConfig();

        if (!config.soulseek.slskdApiKey) {
          console.log(chalk.red("Missing slskd API key."));
          console.log(chalk.dim("Set soulseek.slskdApiKey in your config."));
          return;
        }

        const soulseek = new SoulseekService(config.soulseek);

        console.log(chalk.dim(`Searching Soulseek for "${query}"...`));
        console.log();

        const files = await soulseek.search(query);

        if (files.length === 0) {
          console.log(chalk.yellow("No results found."));
          return;
        }

        const filenameW = 50;
        const userW = 16;
        const sizeW = 10;
        const brW = 6;

        console.log(
          chalk.bold(
            `${"Filename".padEnd(filenameW)}  ${"User".padEnd(userW)}  ${"Size".padEnd(sizeW)}  ${"BR".padEnd(brW)}`,
          ),
        );
        console.log(chalk.dim("─".repeat(filenameW + userW + sizeW + brW + 6)));

        // Show top 25 results
        const display = files.slice(0, 25);

        for (const file of display) {
          const parts = file.filename.split(/[/\\]/);
          const shortName = parts[parts.length - 1]?.slice(0, filenameW) ?? "";
          const user = (file.username ?? "").slice(0, userW);
          const sizeMb = file.size ? `${(file.size / (1024 * 1024)).toFixed(1)}MB` : "—";
          const br = file.bitRate ? `${file.bitRate}` : "—";

          console.log(
            `${shortName.padEnd(filenameW)}  ${chalk.dim(user.padEnd(userW))}  ${sizeMb.padStart(sizeW)}  ${chalk.cyan(br.padStart(brW))}`,
          );
        }

        console.log();
        console.log(chalk.dim(`${files.length} result(s) total, showing top ${display.length}.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Search failed: ${message}`));
      }
    });

  download
    .command("playlist <id>")
    .description("Download missing tracks for a playlist")
    .action((id: string) => {
      console.log(chalk.yellow("Not yet implemented."));
      console.log(
        chalk.dim(
          `Will find unmatched tracks in playlist ${id} and download them from Soulseek.`,
        ),
      );
    });

  download
    .command("resume")
    .description("Resume interrupted downloads")
    .action(() => {
      console.log(chalk.yellow("Not yet implemented."));
      console.log(
        chalk.dim(
          "Will resume any downloads with status 'searching', 'downloading', or 'validating'.",
        ),
      );
    });
}
