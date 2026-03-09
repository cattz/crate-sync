import { Command } from "commander";
import chalk from "chalk";

export function registerLexiconCommands(program: Command): void {
  const lexicon = program
    .command("lexicon")
    .description("Lexicon DJ integration");

  lexicon
    .command("status")
    .description("Test Lexicon connection")
    .action(() => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim("Will connect to the Lexicon API and report version and library stats."),
      );
    });

  lexicon
    .command("match <playlist>")
    .description("Match playlist tracks against Lexicon library")
    .action((playlist: string) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(
          `Will match tracks from playlist "${playlist}" against Lexicon's local library using the configured matching strategy.`,
        ),
      );
    });

  lexicon
    .command("sync <playlist>")
    .description("Sync matched tracks to a Lexicon playlist")
    .action((playlist: string) => {
      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(
          `Will create/update a Lexicon playlist with confirmed matches for "${playlist}".`,
        ),
      );
    });
}
