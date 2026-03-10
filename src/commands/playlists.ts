import { Command } from "commander";
import chalk from "chalk";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { PlaylistService } from "../services/playlist-service.js";
import { SpotifyService } from "../services/spotify-service.js";
import { loadConfig } from "../config.js";

export function registerPlaylistCommands(program: Command): void {
  const playlists = program
    .command("playlists")
    .description("Playlist management");

  playlists
    .command("list")
    .description("List playlists from local DB")
    .action(() => {
      const db = getDb();
      const service = new PlaylistService(db);
      const rows = service.getPlaylists();

      if (rows.length === 0) {
        console.log(chalk.dim("No playlists in database. Run `crate-sync db sync` first."));
        return;
      }

      const nameW = 40;
      const tracksW = 8;
      const syncedW = 20;

      console.log(
        chalk.bold(
          `${"Name".padEnd(nameW)}  ${"Tracks".padEnd(tracksW)}  ${"Last Synced".padEnd(syncedW)}`,
        ),
      );
      console.log(chalk.dim("─".repeat(nameW + tracksW + syncedW + 4)));

      for (const row of rows) {
        const name = (row.name ?? "").slice(0, nameW);
        const trackCount = service.getPlaylistTracks(row.id).length;
        const synced = row.lastSynced
          ? new Date(row.lastSynced).toISOString().slice(0, 16).replace("T", " ")
          : chalk.dim("never");

        console.log(
          `${name.padEnd(nameW)}  ${chalk.cyan(String(trackCount).padStart(tracksW))}  ${synced}`,
        );
      }

      console.log();
      console.log(chalk.dim(`${rows.length} playlist(s)`));
    });

  playlists
    .command("show <id>")
    .description("Show playlist details and tracks")
    .action((id: string) => {
      try {
        const db = getDb();
        const service = new PlaylistService(db);

        const playlist = service.getPlaylist(id);
        if (!playlist) {
          console.log(chalk.red(`Playlist not found: ${id}`));
          console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
          return;
        }

        const tracks = service.getPlaylistTracks(playlist.id);

        console.log(chalk.bold(playlist.name));
        console.log();
        console.log(`  ID           ${chalk.dim(playlist.id)}`);
        console.log(`  Spotify ID   ${chalk.dim(playlist.spotifyId ?? "—")}`);
        if (playlist.description) {
          console.log(`  Description  ${chalk.dim(playlist.description)}`);
        }
        console.log(`  Tracks       ${chalk.cyan(String(tracks.length))}`);
        console.log(
          `  Last Synced  ${playlist.lastSynced ? new Date(playlist.lastSynced).toISOString().slice(0, 16).replace("T", " ") : chalk.dim("never")}`,
        );

        if (tracks.length > 0) {
          console.log();

          const numW = 4;
          const titleW = 35;
          const artistW = 25;
          const albumW = 20;

          console.log(
            chalk.bold(
              `${"#".padStart(numW)}  ${"Title".padEnd(titleW)}  ${"Artist".padEnd(artistW)}  ${"Album".padEnd(albumW)}`,
            ),
          );
          console.log(chalk.dim("─".repeat(numW + titleW + artistW + albumW + 6)));

          for (const track of tracks) {
            const num = String(track.position + 1).padStart(numW);
            const title = (track.title ?? "").slice(0, titleW).padEnd(titleW);
            const artist = (track.artist ?? "").slice(0, artistW).padEnd(artistW);
            const album = (track.album ?? "").slice(0, albumW);

            console.log(
              `${chalk.dim(num)}  ${title}  ${chalk.dim(artist)}  ${chalk.dim(album)}`,
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  playlists
    .command("rename <id> <name>")
    .description("Rename a playlist")
    .option("--push", "Also rename on Spotify")
    .action(async (id: string, name: string, opts: { push?: boolean }) => {
      try {
        const db = getDb();
        const service = new PlaylistService(db);

        const playlist = service.getPlaylist(id);
        if (!playlist) {
          console.log(chalk.red(`Playlist not found: ${id}`));
          console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
          return;
        }

        const oldName = playlist.name;
        service.renamePlaylist(playlist.id, name);
        console.log(chalk.green(`Renamed "${oldName}" → "${name}" in local DB.`));

        if (opts.push) {
          if (!playlist.spotifyId) {
            console.log(chalk.yellow("No Spotify ID for this playlist — skipping Spotify update."));
            return;
          }

          const config = loadConfig();
          const spotify = new SpotifyService(config.spotify);

          if (!(await spotify.isAuthenticated())) {
            console.log(chalk.red("Not authenticated with Spotify. Run `crate-sync auth login` first."));
            return;
          }

          await spotify.renamePlaylist(playlist.spotifyId, name);
          console.log(chalk.green(`Renamed on Spotify.`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  playlists
    .command("merge <ids...>")
    .description("Merge multiple playlists into one")
    .action((ids: string[]) => {
      console.log(chalk.yellow("Not yet implemented."));
      console.log(
        chalk.dim(`Will merge playlists ${ids.join(", ")} into a single playlist.`),
      );
    });

  playlists
    .command("dupes [id]")
    .description("Find duplicate tracks")
    .action((id?: string) => {
      try {
        const db = getDb();
        const service = new PlaylistService(db);

        if (id) {
          // Find duplicates within a single playlist
          const playlist = service.getPlaylist(id);
          if (!playlist) {
            console.log(chalk.red(`Playlist not found: ${id}`));
            return;
          }

          const dupes = service.findDuplicatesInPlaylist(playlist.id);

          if (dupes.length === 0) {
            console.log(chalk.green(`No duplicates found in "${playlist.name}".`));
            return;
          }

          console.log(chalk.bold(`Duplicates in "${playlist.name}"`));
          console.log();

          for (const group of dupes) {
            console.log(
              `  ${chalk.cyan(group.track.title)} — ${chalk.dim(group.track.artist)}` +
              chalk.yellow(` (${group.duplicates.length + 1} copies)`),
            );
          }

          console.log();
          console.log(chalk.dim(`${dupes.length} duplicate group(s) found.`));
        } else {
          // Find duplicates across all playlists
          const dupes = service.findDuplicatesAcrossPlaylists();

          if (dupes.length === 0) {
            console.log(chalk.green("No tracks appear in multiple playlists."));
            return;
          }

          console.log(chalk.bold("Tracks in multiple playlists"));
          console.log();

          for (const item of dupes) {
            const playlistNames = item.playlists.map((p) => p.name).join(", ");
            console.log(
              `  ${chalk.cyan(item.track.title)} — ${chalk.dim(item.track.artist)}`,
            );
            console.log(
              `    ${chalk.dim("in:")} ${playlistNames}`,
            );
          }

          console.log();
          console.log(chalk.dim(`${dupes.length} track(s) found in multiple playlists.`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  playlists
    .command("delete <id>")
    .description("Delete a playlist")
    .option("--spotify", "Also delete (unfollow) on Spotify")
    .action(async (id: string, opts: { spotify?: boolean }) => {
      try {
        const db = getDb();
        const service = new PlaylistService(db);

        const playlist = service.getPlaylist(id);
        if (!playlist) {
          console.log(chalk.red(`Playlist not found: ${id}`));
          console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
          return;
        }

        const trackCount = service.getPlaylistTracks(playlist.id).length;

        const rl = readline.createInterface({ input, output });
        const answer = await rl.question(
          chalk.yellow(`Delete playlist "${playlist.name}" with ${trackCount} tracks? [y/N] `),
        );
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log(chalk.dim("Cancelled."));
          return;
        }

        service.removePlaylist(playlist.id);
        console.log(chalk.green(`Deleted "${playlist.name}" from local DB.`));

        if (opts.spotify) {
          if (!playlist.spotifyId) {
            console.log(chalk.yellow("No Spotify ID for this playlist — skipping Spotify delete."));
            return;
          }

          const config = loadConfig();
          const spotify = new SpotifyService(config.spotify);

          if (!(await spotify.isAuthenticated())) {
            console.log(chalk.red("Not authenticated with Spotify. Run `crate-sync auth login` first."));
            return;
          }

          await spotify.deletePlaylist(playlist.spotifyId);
          console.log(chalk.green(`Unfollowed on Spotify.`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });
}
