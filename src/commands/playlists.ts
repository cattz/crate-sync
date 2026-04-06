import { Command } from "commander";
import chalk from "chalk";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { PlaylistService } from "../services/playlist-service.js";
import { SpotifyService } from "../services/spotify-service.js";
import { pushPlaylist } from "../services/spotify-push.js";
import { loadConfig } from "../config.js";

export function registerPlaylistCommands(program: Command): void {
  const playlists = program
    .command("playlists")
    .description("Playlist management");

  playlists
    .command("list")
    .description("List playlists from local DB")
    .option("--owner <filter>", "Ownership filter: all, own, followed", "own")
    .option("--filter <pattern>", "Filter playlists by name (substring or regex with --regex)")
    .option("--regex", "Treat --filter as a regular expression")
    .action((opts: { owner: string; filter?: string; regex?: boolean }) => {
      const db = getDb();
      const service = PlaylistService.fromDb(db);
      let rows = service.getPlaylists();

      if (opts.owner === "own") {
        rows = rows.filter((r) => r.isOwned === 1);
      } else if (opts.owner === "followed") {
        rows = rows.filter((r) => r.isOwned === 0);
      }

      if (opts.filter) {
        if (opts.regex) {
          try {
            const re = new RegExp(opts.filter);
            rows = rows.filter((r) => re.test(r.name));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.red(`Invalid regex: ${message}`));
            return;
          }
        } else {
          const q = opts.filter.toLowerCase();
          rows = rows.filter((r) => r.name.toLowerCase().includes(q));
        }
      }

      if (rows.length === 0) {
        console.log(chalk.dim("No playlists in database. Run `crate-sync db sync` first."));
        return;
      }

      const idW = 8;
      const nameW = 40;
      const tracksW = 8;
      const syncedW = 20;

      console.log(
        chalk.bold(
          `${"ID".padEnd(idW)}  ${"Name".padEnd(nameW)}  ${"Tracks".padEnd(tracksW)}  ${"Last Synced".padEnd(syncedW)}`,
        ),
      );
      console.log(chalk.dim("\u2500".repeat(idW + nameW + tracksW + syncedW + 6)));

      for (const row of rows) {
        const shortId = row.id.slice(0, 8);
        const name = (row.name ?? "").slice(0, nameW);
        const trackCount = service.getPlaylistTracks(row.id).length;
        const synced = row.lastSynced
          ? new Date(row.lastSynced).toISOString().slice(0, 16).replace("T", " ")
          : chalk.dim("never");

        console.log(
          `${chalk.dim(shortId.padEnd(idW))}  ${name.padEnd(nameW)}  ${chalk.cyan(String(trackCount).padStart(tracksW))}  ${synced}`,
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
        const service = PlaylistService.fromDb(db);

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
        console.log(`  Spotify ID   ${chalk.dim(playlist.spotifyId ?? "\u2014")}`);
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
          console.log(chalk.dim("\u2500".repeat(numW + titleW + artistW + albumW + 6)));

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
        const service = PlaylistService.fromDb(db);

        const playlist = service.getPlaylist(id);
        if (!playlist) {
          console.log(chalk.red(`Playlist not found: ${id}`));
          console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
          return;
        }

        const oldName = playlist.name;
        service.renamePlaylist(playlist.id, name);
        console.log(chalk.green(`Renamed "${oldName}" \u2192 "${name}" in local DB.`));

        if (opts.push) {
          if (!playlist.spotifyId) {
            console.log(chalk.yellow("No Spotify ID for this playlist \u2014 skipping Spotify update."));
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

  // ---------------------------------------------------------------------------
  // playlists bulk-rename <pattern> <replacement>
  // ---------------------------------------------------------------------------

  playlists
    .command("bulk-rename <pattern> <replacement>")
    .description("Bulk rename playlists matching a pattern")
    .option("--regex", "Treat pattern as a regular expression")
    .option("--dry-run", "Show what would be renamed without applying changes")
    .option("--filter <name-filter>", "Only consider playlists whose name matches this substring")
    .action((pattern: string, replacement: string, opts: { regex?: boolean; dryRun?: boolean; filter?: string }) => {
      try {
        const db = getDb();
        const service = PlaylistService.fromDb(db);

        let regexPattern: string | RegExp;
        if (opts.regex) {
          try {
            regexPattern = new RegExp(pattern);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.red(`Invalid regex: ${message}`));
            return;
          }
        } else {
          regexPattern = pattern;
        }

        // Pre-filter by --filter flag to scope which playlists are candidates
        let playlistIds: string[] | undefined;
        if (opts.filter) {
          const q = opts.filter.toLowerCase();
          const matching = service.getPlaylists().filter((p) => p.name.toLowerCase().includes(q));
          playlistIds = matching.map((p) => p.id);
        }

        const results = service.bulkRename(regexPattern, replacement, { dryRun: opts.dryRun, playlistIds });

        if (results.length === 0) {
          console.log(chalk.dim("No playlists matched."));
          return;
        }

        console.log(chalk.bold(opts.dryRun ? "Bulk rename preview:" : "Bulk rename results:"));
        for (const r of results) {
          console.log(`  "${r.oldName}" \u2192 "${r.newName}"`);
        }

        console.log();
        console.log(chalk.dim(`${results.length} playlist(s) affected`));
        if (opts.dryRun) {
          console.log(chalk.dim("(dry run \u2014 no changes applied)"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  // ---------------------------------------------------------------------------
  // playlists merge <target> <source...>
  // ---------------------------------------------------------------------------

  playlists
    .command("merge <target> <source...>")
    .description("Merge tracks from source playlists into a target playlist")
    .option("--delete-sources", "Delete source playlists after merge")
    .action((target: string, sources: string[], opts: { deleteSources?: boolean }) => {
      try {
        const db = getDb();
        const service = PlaylistService.fromDb(db);

        const targetPlaylist = service.getPlaylist(target);
        if (!targetPlaylist) {
          console.log(chalk.red(`Target playlist not found: ${target}`));
          return;
        }

        const sourceIds: string[] = [];
        for (const s of sources) {
          const pl = service.getPlaylist(s);
          if (!pl) {
            console.log(chalk.red(`Source playlist not found: ${s}`));
            return;
          }
          sourceIds.push(pl.id);
        }

        const result = service.mergePlaylists(targetPlaylist.id, sourceIds, opts.deleteSources);

        console.log(chalk.green(`Merged into "${targetPlaylist.name}"`));
        console.log(`  Added: ${chalk.cyan(String(result.added))} tracks`);
        console.log(`  Duplicates skipped: ${chalk.dim(String(result.duplicates))}`);
        if (opts.deleteSources) {
          console.log(`  Source playlists deleted: ${chalk.yellow(String(result.sourcesDeleted))}`);
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
        const service = PlaylistService.fromDb(db);

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
            console.log(chalk.yellow("No Spotify ID for this playlist \u2014 skipping Spotify delete."));
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

  // ---------------------------------------------------------------------------
  // playlists push [id]
  // ---------------------------------------------------------------------------

  playlists
    .command("push [id]")
    .description("Push local playlist changes back to Spotify")
    .option("--all", "Push all playlists")
    .action(async (id: string | undefined, opts: { all?: boolean }) => {
      try {
        if (!id && !opts.all) {
          console.log(chalk.red("Provide a playlist ID or use --all."));
          return;
        }

        const config = loadConfig();
        const spotify = new SpotifyService(config.spotify);

        if (!(await spotify.isAuthenticated())) {
          console.log(chalk.red("Not authenticated with Spotify. Run `crate-sync auth login` first."));
          return;
        }

        const db = getDb();
        const service = PlaylistService.fromDb(db);

        // Resolve which playlists to push
        let playlistsToPush: schema.Playlist[];

        if (opts.all) {
          playlistsToPush = service.getPlaylists().filter((p) => p.spotifyId != null);
          if (playlistsToPush.length === 0) {
            console.log(chalk.dim("No playlists with Spotify IDs found."));
            return;
          }
        } else {
          const playlist = service.getPlaylist(id!);
          if (!playlist) {
            console.log(chalk.red(`Playlist not found: ${id}`));
            console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
            return;
          }
          if (!playlist.spotifyId) {
            console.log(chalk.red(`Playlist "${playlist.name}" has no Spotify ID \u2014 cannot push.`));
            return;
          }
          playlistsToPush = [playlist];
        }

        console.log(chalk.bold(`Pushing ${playlistsToPush.length} playlist(s) to Spotify...`));
        console.log();

        for (const playlist of playlistsToPush) {
          try {
            const summary = await pushPlaylist(playlist.id, spotify, service);

            const hasChanges =
              summary.renamed != null ||
              summary.descriptionUpdated ||
              summary.tracksAdded > 0 ||
              summary.tracksRemoved > 0;

            if (!hasChanges) {
              console.log(chalk.dim(`  ${playlist.name} \u2014 no changes`));
              continue;
            }

            console.log(chalk.cyan(`  ${playlist.name}`));

            if (summary.renamed) {
              console.log(chalk.green(`    Renamed to "${summary.renamed.to}"`));
            }
            if (summary.descriptionUpdated) {
              console.log(chalk.yellow(`    Description synced`));
            }
            if (summary.tracksRemoved > 0) {
              console.log(chalk.yellow(`    Removed ${summary.tracksRemoved} track(s)`));
            }
            if (summary.tracksAdded > 0) {
              console.log(chalk.green(`    Added ${summary.tracksAdded} track(s)`));
            }

            // Refresh snapshot_id
            const spotifyPlaylists = await spotify.getPlaylists();
            const updated = spotifyPlaylists.find((p) => p.id === playlist.spotifyId);
            if (updated) {
              service.updateSnapshotId(playlist.id, updated.snapshotId);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.red(`  ${playlist.name} \u2014 failed: ${message}`));
          }
        }

        console.log();
        console.log(chalk.green("Done."));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });
}
