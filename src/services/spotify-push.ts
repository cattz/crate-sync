import type { SpotifyService } from "./spotify-service.js";
import type { PlaylistService } from "./playlist-service.js";

export interface PushOptions {
  dryRun?: boolean;
  includeDescription?: boolean;
  /** Skip confirmation for large removals. */
  confirmed?: boolean;
}

export interface PushSummary {
  playlistId: string;
  playlistName: string;
  renamed: { from: string; to: string } | null;
  descriptionUpdated: boolean;
  tracksAdded: number;
  tracksRemoved: number;
  dryRun: boolean;
  /** Set when push requires confirmation before proceeding. */
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

export async function pushPlaylist(
  playlistId: string,
  spotifyService: SpotifyService,
  playlistService: PlaylistService,
  options?: PushOptions,
): Promise<PushSummary> {
  const dryRun = options?.dryRun ?? false;
  const includeDescription = options?.includeDescription ?? true;

  const playlist = playlistService.getPlaylist(playlistId);

  // Safety: never push a playlist that has only local/broken tracks
  if (playlist) {
    const tracks = playlistService.getPlaylistTracks(playlistId);
    const hasRealTracks = tracks.some(t => t.spotifyUri && !t.spotifyUri.startsWith("spotify:local:"));
    if (!hasRealTracks && tracks.length > 0) {
      throw new Error(
        `Safety: playlist "${playlist.name}" contains only local/broken tracks. ` +
        `Repair the playlist first, then push.`
      );
    }
  }
  if (!playlist) {
    throw new Error(`Playlist not found: ${playlistId}`);
  }
  if (!playlist.spotifyId) {
    throw new Error(`Playlist has no Spotify ID: ${playlistId}`);
  }

  const spotifyId = playlist.spotifyId;

  // Fetch current Spotify state
  const [spotifyDetails, spotifyTracks] = await Promise.all([
    spotifyService.getPlaylistDetails(spotifyId),
    spotifyService.getPlaylistTracks(spotifyId),
  ]);

  // Detect rename
  const nameChanged = spotifyDetails.name !== playlist.name;

  // Detect description change
  let descriptionChanged = false;
  let composedDescription = "";
  if (includeDescription) {
    composedDescription = playlistService.composeDescription(playlistId);
    descriptionChanged = spotifyDetails.description !== composedDescription;
  }

  // Detect track diff
  const diff = playlistService.getPlaylistDiff(playlistId, spotifyTracks);

  // Execute changes (skip if dry run)
  if (!dryRun) {
    if (nameChanged) {
      await spotifyService.renamePlaylist(spotifyId, playlist.name);
    }
    if (descriptionChanged) {
      await spotifyService.updatePlaylistDescription(spotifyId, composedDescription);
    }
    if (diff.toRemove.length > 0) {
      // Safety: refuse to remove all tracks — likely a sync/DB mismatch
      const spotifyTrackCount = spotifyDetails.tracks?.total ?? 0;
      if (diff.toRemove.length >= spotifyTrackCount && spotifyTrackCount > 0 && diff.toAdd.length === 0) {
        throw new Error(
          `Safety: push would remove all ${diff.toRemove.length} tracks from Spotify with nothing to add. ` +
          `This usually means the local DB is out of sync. Run "Pull from Spotify" first.`
        );
      }

      // Safety: require confirmation when removing more than 3 tracks
      if (diff.toRemove.length > 3 && !options?.confirmed) {
        return {
          playlistId: playlist.id,
          playlistName: playlist.name,
          renamed: nameChanged ? { from: spotifyDetails.name, to: playlist.name } : null,
          descriptionUpdated: false,
          tracksAdded: diff.toAdd.length,
          tracksRemoved: diff.toRemove.length,
          dryRun: false,
          requiresConfirmation: true,
          confirmationMessage: `This push will remove ${diff.toRemove.length} tracks from "${playlist.name}" on Spotify. Confirm?`,
        };
      }

      await spotifyService.removeTracksFromPlaylist(spotifyId, diff.toRemove);
    }
    if (diff.toAdd.length > 0) {
      await spotifyService.addTracksToPlaylist(spotifyId, diff.toAdd);
    }
  }

  return {
    playlistId: playlist.id,
    playlistName: playlist.name,
    renamed: nameChanged ? { from: spotifyDetails.name, to: playlist.name } : null,
    descriptionUpdated: descriptionChanged && !dryRun,
    tracksAdded: diff.toAdd.length,
    tracksRemoved: diff.toRemove.length,
    dryRun,
  };
}
