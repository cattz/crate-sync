import { Command } from "commander";
import chalk from "chalk";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { PlaylistService } from "../services/playlist-service.js";
import { SpotifyService } from "../services/spotify-service.js";
import { SyncPipeline } from "../services/sync-pipeline.js";
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

  // ---------------------------------------------------------------------------
  // playlists repair <id>
  // ---------------------------------------------------------------------------

  playlists
    .command("repair <id>")
    .description("Fix broken/unplayable tracks by re-matching against Lexicon")
    .option("--download", "Download missing tracks via Soulseek")
    .action(async (id: string, opts: { download?: boolean }) => {
      try {
        const db = getDb();
        const service = new PlaylistService(db);

        const playlist = service.getPlaylist(id);
        if (!playlist) {
          console.log(chalk.red(`Playlist not found: ${id}`));
          console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
          return;
        }

        const config = loadConfig();
        const pipeline = new SyncPipeline(config, { db });

        console.log(chalk.bold(`Repairing "${playlist.name}"...`));
        console.log();

        // Phase 1: match all tracks against Lexicon
        const result = await pipeline.matchPlaylist(playlist.id);

        // Print report
        const okCount = result.found.length;
        const reviewCount = result.needsReview.length;
        const missingCount = result.notFound.length;

        console.log(chalk.green(`  ${okCount} tracks OK`) + chalk.dim(" (matched in Lexicon)"));
        if (reviewCount > 0) {
          console.log(chalk.yellow(`  ${reviewCount} tracks need review`) + chalk.dim(" (uncertain match)"));
        }
        console.log(chalk.red(`  ${missingCount} tracks need repair`) + chalk.dim(" (not found in Lexicon)"));
        console.log(chalk.dim(`  ${result.total} total`));

        // List tracks needing review
        if (result.needsReview.length > 0) {
          console.log();
          console.log(chalk.bold("Needs review:"));
          for (const item of result.needsReview) {
            console.log(
              `  ${chalk.yellow("?")} ${item.track.title} — ${chalk.dim(item.track.artist)}` +
              chalk.dim(` (score: ${item.score.toFixed(2)})`),
            );
          }
        }

        // List tracks not found
        if (result.notFound.length > 0) {
          console.log();
          console.log(chalk.bold("Not found in Lexicon:"));
          for (const item of result.notFound) {
            console.log(
              `  ${chalk.red("x")} ${item.track.title} — ${chalk.dim(item.track.artist)}`,
            );
          }
        }

        // Optionally download missing tracks
        if (opts.download && missingCount > 0) {
          console.log();
          console.log(chalk.bold(`Downloading ${missingCount} missing tracks...`));

          // Build a PhaseTwoResult treating all review items as missing
          const phaseTwo = pipeline.applyReviewDecisions(result, []);

          const downloadResult = await pipeline.downloadMissing(
            phaseTwo,
            result.playlistName,
            (completed, total, title, success) => {
              const icon = success ? chalk.green("v") : chalk.red("x");
              console.log(`  ${icon} [${completed}/${total}] ${title}`);
            },
          );

          console.log();
          console.log(
            chalk.green(`  ${downloadResult.succeeded} downloaded`) +
            (downloadResult.failed > 0 ? chalk.red(` / ${downloadResult.failed} failed`) : ""),
          );
        } else if (missingCount > 0 && !opts.download) {
          console.log();
          console.log(chalk.dim("Use --download to attempt downloading missing tracks via Soulseek."));
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
        const service = new PlaylistService(db);

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
            console.log(chalk.red(`Playlist "${playlist.name}" has no Spotify ID — cannot push.`));
            return;
          }
          playlistsToPush = [playlist];
        }

        console.log(chalk.bold(`Pushing ${playlistsToPush.length} playlist(s) to Spotify...`));
        console.log();

        for (const playlist of playlistsToPush) {
          const spotifyId = playlist.spotifyId!;

          try {
            // Get current Spotify state
            const spotifyTracks = await spotify.getPlaylistTracks(spotifyId);

            // Compare local vs Spotify
            const diff = service.getPlaylistDiff(playlist.id, spotifyTracks);

            // Check if name was changed by fetching Spotify playlist metadata
            const spotifyPlaylists = await spotify.getPlaylists();
            const spotifyPlaylist = spotifyPlaylists.find((p) => p.id === spotifyId);
            const nameChanged = spotifyPlaylist ? spotifyPlaylist.name !== playlist.name : false;

            const hasChanges = nameChanged || diff.toAdd.length > 0 || diff.toRemove.length > 0;

            if (!hasChanges) {
              console.log(chalk.dim(`  ${playlist.name} — no changes`));
              continue;
            }

            console.log(chalk.cyan(`  ${playlist.name}`));

            // Apply rename
            if (nameChanged) {
              await spotify.renamePlaylist(spotifyId, playlist.name);
              console.log(chalk.green(`    Renamed to "${playlist.name}"`));
            }

            // Remove tracks
            if (diff.toRemove.length > 0) {
              await spotify.removeTracksFromPlaylist(spotifyId, diff.toRemove);
              console.log(chalk.yellow(`    Removed ${diff.toRemove.length} track(s)`));
            }

            // Add tracks
            if (diff.toAdd.length > 0) {
              await spotify.addTracksToPlaylist(spotifyId, diff.toAdd);
              console.log(chalk.green(`    Added ${diff.toAdd.length} track(s)`));
            }

            // Refresh snapshot_id from Spotify
            const updatedPlaylists = await spotify.getPlaylists();
            const updated = updatedPlaylists.find((p) => p.id === spotifyId);
            if (updated) {
              service.updateSnapshotId(playlist.id, updated.snapshotId);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.red(`  ${playlist.name} — failed: ${message}`));
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
