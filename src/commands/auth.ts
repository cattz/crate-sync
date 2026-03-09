import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, getConfigPath } from "../config.js";

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage Spotify authentication");

  auth
    .command("login")
    .description("Start Spotify OAuth flow")
    .action(() => {
      const config = loadConfig();
      const configPath = getConfigPath();

      if (!config.spotify.clientId || !config.spotify.clientSecret) {
        console.log(chalk.red("Missing Spotify credentials."));
        console.log(
          chalk.dim(`Set clientId and clientSecret in ${configPath}`),
        );
        console.log();
        console.log(chalk.dim("Example config:"));
        console.log(
          chalk.dim(
            JSON.stringify(
              {
                spotify: {
                  clientId: "<your-client-id>",
                  clientSecret: "<your-client-secret>",
                },
              },
              null,
              2,
            ),
          ),
        );
        return;
      }

      console.log(chalk.yellow("⏳ Not yet implemented."));
      console.log(
        chalk.dim(
          "Will start an OAuth2 PKCE flow, open the browser, and store the refresh token.",
        ),
      );
    });

  auth
    .command("status")
    .description("Show authentication status")
    .action(() => {
      const config = loadConfig();

      const hasId = !!config.spotify.clientId;
      const hasSecret = !!config.spotify.clientSecret;

      console.log(chalk.bold("Spotify Auth Status"));
      console.log();
      console.log(
        `  Client ID      ${hasId ? chalk.green("configured") : chalk.red("missing")}`,
      );
      console.log(
        `  Client Secret  ${hasSecret ? chalk.green("configured") : chalk.red("missing")}`,
      );
      console.log(
        `  Redirect URI   ${chalk.dim(config.spotify.redirectUri)}`,
      );

      if (!hasId || !hasSecret) {
        console.log();
        console.log(
          chalk.dim(`Config path: ${getConfigPath()}`),
        );
      }
    });
}
