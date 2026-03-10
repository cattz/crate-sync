import { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { PlaylistService } from "../services/playlist-service.js";

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
    .action((id: string, name: string) => {
      console.log(chalk.yellow("Not yet implemented."));
      console.log(chalk.dim(`Will rename playlist ${id} to "${name}".`));
    });

  playlists
    .command("merge <ids...>")
    .description("Merge multiple playlists into one")
    .option("--target <id>", "Playlist to merge into (default: first one)")
    .option("--name <name>", "Create a new playlist with this name instead")
    .action((ids: string[], options: { target?: string; name?: string }) => {
      try {
        if (ids.length < 2) {
          console.log(chalk.red("Need at least 2 playlist IDs to merge."));
          return;
        }

        const db = getDb();
        const service = new PlaylistService(db);

        // Resolve all playlists
        const resolved: Array<{ playlist: schema.Playlist; tracks: Array<schema.Track & { position: number }> }> = [];
        for (const id of ids) {
          const playlist = service.getPlaylist(id);
          if (!playlist) {
            console.log(chalk.red(`Playlist not found: ${id}`));
            return;
          }
          const tracks = service.getPlaylistTracks(playlist.id);
          resolved.push({ playlist, tracks });
        }

        // Compute totals
        const totalTracks = resolved.reduce((sum, r) => sum + r.tracks.length, 0);
        const uniqueTrackIds = new Set(resolved.flatMap((r) => r.tracks.map((t) => t.id)));
        const uniqueCount = uniqueTrackIds.size;

        console.log(
          chalk.bold(`Merging ${resolved.length} playlists`) +
          chalk.dim(` (${totalTracks} total tracks, ${uniqueCount} unique)`),
        );
        console.log();

        for (const r of resolved) {
          console.log(`  ${chalk.cyan(r.playlist.name)} — ${r.tracks.length} tracks`);
        }
        console.log();

        let targetPlaylist: schema.Playlist;
        let sourcePlaylistIds: string[];

        if (options.name) {
          // Create a new playlist
          targetPlaylist = service.createPlaylist(options.name);
          sourcePlaylistIds = resolved.map((r) => r.playlist.id);
          console.log(chalk.dim(`Creating new playlist: "${options.name}"`));
        } else {
          // Determine target
          const targetId = options.target;
          if (targetId) {
            const found = resolved.find(
              (r) => r.playlist.id === targetId || r.playlist.spotifyId === targetId || r.playlist.name === targetId,
            );
            if (!found) {
              console.log(chalk.red(`Target playlist "${targetId}" is not among the playlists being merged.`));
              return;
            }
            targetPlaylist = found.playlist;
          } else {
            targetPlaylist = resolved[0].playlist;
          }

          sourcePlaylistIds = resolved
            .filter((r) => r.playlist.id !== targetPlaylist.id)
            .map((r) => r.playlist.id);

          console.log(chalk.dim(`Merging into: "${targetPlaylist.name}"`));
        }

        const result = service.mergePlaylistTracks(targetPlaylist.id, sourcePlaylistIds);

        console.log();
        console.log(chalk.green(`Done.`));
        console.log(`  ${chalk.cyan(String(result.added))} tracks added`);
        console.log(`  ${chalk.dim(String(result.duplicatesSkipped))} duplicates skipped`);

        const finalTracks = service.getPlaylistTracks(targetPlaylist.id);
        console.log(`  ${chalk.bold(String(finalTracks.length))} total tracks in "${targetPlaylist.name}"`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
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
    .action((id: string) => {
      console.log(chalk.yellow("Not yet implemented."));
      console.log(chalk.dim(`Will delete playlist ${id} from the local database.`));
    });
}
