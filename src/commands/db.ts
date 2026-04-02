import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { getDb } from "../db/client.js";
import { count } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { SpotifyService } from "../services/spotify-service.js";
import { PlaylistService } from "../services/playlist-service.js";
import { Progress } from "../utils/progress.js";
import { isShutdownRequested } from "../utils/shutdown.js";

export function registerDbCommands(program: Command): void {
  const db = program
    .command("db")
    .description("Local database management");

  db.command("sync")
    .description("Sync Spotify playlists to local DB")
    .action(async () => {
      try {
        const config = loadConfig();
        const spotify = new SpotifyService(config.spotify);

        const authenticated = await spotify.isAuthenticated();
        if (!authenticated) {
          console.log(chalk.red("Not authenticated. Run `crate-sync auth login` first."));
          return;
        }

        console.log(chalk.dim("Syncing playlists from Spotify..."));

        const database = getDb();
        const playlistService = PlaylistService.fromDb(database);

        const apiPlaylists = await spotify.getPlaylists();
        const currentUserId = await spotify.getCurrentUserId();
        const result = playlistService.syncPlaylistsFromApi(apiPlaylists, currentUserId);

        console.log();
        console.log(chalk.bold("Playlist sync complete"));
        console.log(`  Added      ${chalk.green(String(result.added))}`);
        console.log(`  Updated    ${chalk.yellow(String(result.updated))}`);
        console.log(`  Unchanged  ${chalk.dim(String(result.unchanged))}`);

        // Now sync tracks for each playlist
        const allPlaylists = database.select().from(schema.playlists).all();

        const syncable = allPlaylists.filter((pl) => pl.spotifyId);
        console.log();
        console.log(chalk.dim(`Syncing tracks for ${syncable.length} playlist(s)...`));
        console.log();

        const progress = new Progress(syncable.length, "Playlists");

        for (const pl of syncable) {
          if (isShutdownRequested()) {
            console.log(chalk.yellow("\nShutdown requested, stopping playlist sync."));
            break;
          }

          try {
            const apiTracks = await spotify.getPlaylistTracks(pl.spotifyId!);
            const trackResult = playlistService.syncPlaylistTracksFromApi(pl.spotifyId!, apiTracks);
            progress.tick(
              `${pl.name.slice(0, 30)}  ${chalk.green(`+${trackResult.added}`)}${chalk.dim("/")}${chalk.yellow(`~${trackResult.updated}`)}`,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            progress.tick(`${pl.name.slice(0, 30)}  ${chalk.red(`error: ${message}`)}`);
          }
        }

        console.log();
        console.log(chalk.green("Sync complete."));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Sync failed: ${message}`));
      }
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
