import { Command } from "commander";
import chalk from "chalk";

export function registerDownloadCommands(program: Command): void {
  const download = program
    .command("download")
    .description("Download tracks via Soulseek");

  download
    .command("search <query>")
    .description("Search Soulseek for a track")
    .action((query: string) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(
          `Will search Soulseek via slskd for "${query}" and display results ranked by quality.`,
        ),
      );
    });

  download
    .command("playlist <id>")
    .description("Download missing tracks for a playlist")
    .action((id: string) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
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
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(
          "Will resume any downloads with status 'searching', 'downloading', or 'validating'.",
        ),
      );
    });
}
