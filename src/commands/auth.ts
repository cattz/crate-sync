import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, getConfigPath } from "../config.js";
import { SpotifyService } from "../services/spotify-service.js";
import { waitForAuthCallback } from "../services/spotify-auth-server.js";

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage Spotify authentication");

  auth
    .command("login")
    .description("Start Spotify OAuth flow")
    .action(async () => {
      try {
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

        const spotify = new SpotifyService(config.spotify);

        // Generate a random state for CSRF protection
        const state = Math.random().toString(36).slice(2);

        // Extract port from redirectUri
        const redirectUrl = new URL(config.spotify.redirectUri);
        const port = parseInt(redirectUrl.port, 10) || 8888;

        const authUrl = spotify.getAuthUrl(state);

        console.log(chalk.bold("Spotify Authorization"));
        console.log();
        console.log("Open this URL in your browser:");
        console.log();
        console.log(chalk.cyan(authUrl));
        console.log();
        console.log(chalk.dim(`Waiting for callback on port ${port}...`));

        // Wait for the OAuth callback
        const code = await waitForAuthCallback(port);

        console.log(chalk.dim("Received authorization code, exchanging for tokens..."));

        await spotify.exchangeCode(code);

        console.log();
        console.log(chalk.green("Authenticated successfully!"));
        console.log(chalk.dim("Tokens saved. You can now use crate-sync commands."));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Login failed: ${message}`));
      }
    });

  auth
    .command("status")
    .description("Show authentication status")
    .action(async () => {
      try {
        const config = loadConfig();

        const hasId = !!config.spotify.clientId;
        const hasSecret = !!config.spotify.clientSecret;

        const spotify = new SpotifyService(config.spotify);
        const authenticated = await spotify.isAuthenticated();

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
        console.log(
          `  Authenticated  ${authenticated ? chalk.green("yes") : chalk.red("no")}`,
        );

        if (!hasId || !hasSecret) {
          console.log();
          console.log(
            chalk.dim(`Config path: ${getConfigPath()}`),
          );
        }

        if (!authenticated && hasId && hasSecret) {
          console.log();
          console.log(chalk.dim("Run `crate-sync auth login` to authenticate."));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Failed to check auth status: ${message}`));
      }
    });
}
