/**
 * Repair service — finds proper Spotify streaming versions of broken/local tracks.
 */
import type { Track } from "../db/schema.js";
import type { SpotifyTrack } from "../types/spotify.js";
import type { SpotifyApiClient } from "./spotify-api-client.js";
import type { PlaylistService } from "./playlist-service.js";
import { normalizeBase, normalizeArtist } from "../matching/normalize.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepairReplacedTrack {
  original: { id: string; title: string; artist: string };
  replacement: { spotifyUri: string; title: string; artist: string; spotifyId: string };
}

export interface RepairNotFoundTrack {
  id: string;
  title: string;
  artist: string;
}

export interface RepairReport {
  repairedPlaylistId: string;
  repairedPlaylistSpotifyId: string;
  replaced: RepairReplacedTrack[];
  notFound: RepairNotFoundTrack[];
  kept: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBrokenTrack(track: Track): boolean {
  return (
    track.isLocal === 1 ||
    (track.spotifyUri != null && track.spotifyUri.startsWith("spotify:local:"))
  );
}

function bestMatch(
  original: Track,
  candidates: SpotifyTrack[],
): SpotifyTrack | null {
  if (candidates.length === 0) return null;

  const origTitle = normalizeBase(original.title);
  const origArtist = normalizeArtist(original.artist);

  let best: SpotifyTrack | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    // Skip local tracks in search results
    if (c.isLocal || c.uri.startsWith("spotify:local:")) continue;

    const cTitle = normalizeBase(c.title);
    const cArtist = normalizeArtist(c.artist);

    let score = 0;

    // Title match
    if (cTitle === origTitle) {
      score += 1.0;
    } else if (cTitle.includes(origTitle) || origTitle.includes(cTitle)) {
      score += 0.6;
    }

    // Artist match
    if (cArtist === origArtist) {
      score += 1.0;
    } else if (cArtist.includes(origArtist) || origArtist.includes(cArtist)) {
      score += 0.5;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  // Require at least a partial match on both title and artist
  return bestScore >= 1.0 ? best : null;
}

// ---------------------------------------------------------------------------
// Repair workflow
// ---------------------------------------------------------------------------

export async function repairPlaylist(
  playlistId: string,
  playlistService: PlaylistService,
  spotify: SpotifyApiClient,
  options?: { keepNotFound?: boolean },
): Promise<RepairReport> {
  const playlist = playlistService.getPlaylist(playlistId);
  if (!playlist) throw new Error(`Playlist not found: ${playlistId}`);
  if (!playlist.spotifyId) throw new Error("Playlist has no Spotify ID");

  const tracks = playlistService.getPlaylistTracks(playlist.id);

  const replaced: RepairReplacedTrack[] = [];
  const notFound: RepairNotFoundTrack[] = [];
  const repairedUris: string[] = [];
  let kept = 0;

  for (const track of tracks) {
    if (!isBrokenTrack(track)) {
      // Keep working tracks as-is
      if (track.spotifyUri) {
        repairedUris.push(track.spotifyUri);
      }
      kept++;
      continue;
    }

    // Search Spotify for a replacement
    const query = `${track.artist} ${track.title}`;
    try {
      const results = await spotify.searchTracks(query, 5);
      const match = bestMatch(track, results);

      if (match) {
        replaced.push({
          original: { id: track.id, title: track.title, artist: track.artist },
          replacement: {
            spotifyUri: match.uri,
            title: match.title,
            artist: match.artist,
            spotifyId: match.id,
          },
        });
        repairedUris.push(match.uri);
      } else {
        notFound.push({ id: track.id, title: track.title, artist: track.artist });
        if (options?.keepNotFound && track.spotifyUri) {
          repairedUris.push(track.spotifyUri);
        }
      }
    } catch {
      notFound.push({ id: track.id, title: track.title, artist: track.artist });
      if (options?.keepNotFound && track.spotifyUri) {
        repairedUris.push(track.spotifyUri);
      }
    }
  }

  // Create the repaired playlist on Spotify
  const repairedName = `${playlist.name}-repaired`;
  const repairedPlaylist = await spotify.createPlaylist(
    repairedName,
    `Repaired version of ${playlist.name}`,
  );

  if (repairedUris.length > 0) {
    await spotify.addTracksToPlaylist(repairedPlaylist.id, repairedUris);
  }

  return {
    repairedPlaylistId: repairedPlaylist.id,
    repairedPlaylistSpotifyId: repairedPlaylist.id,
    replaced,
    notFound,
    kept,
    total: tracks.length,
  };
}

/**
 * Accept a repair: delete the original playlist and rename the repaired one.
 */
export async function acceptRepair(
  originalPlaylistId: string,
  repairedSpotifyId: string,
  playlistService: PlaylistService,
  spotify: SpotifyApiClient,
): Promise<void> {
  const playlist = playlistService.getPlaylist(originalPlaylistId);
  if (!playlist) throw new Error(`Playlist not found: ${originalPlaylistId}`);
  if (!playlist.spotifyId) throw new Error("Original playlist has no Spotify ID");

  // Delete (unfollow) the original on Spotify
  await spotify.deletePlaylist(playlist.spotifyId);

  // Rename the repaired playlist — remove "-repaired" suffix
  await spotify.renamePlaylist(repairedSpotifyId, playlist.name);

  // Update local DB: point the existing playlist record to the repaired Spotify playlist
  const db = (playlistService as unknown as { db: ReturnType<typeof import("../db/client.js").getDb> }).db;
  const { playlists } = await import("../db/schema.js");
  const { eq } = await import("drizzle-orm");
  db.update(playlists)
    .set({ spotifyId: repairedSpotifyId, lastSynced: Date.now(), brokenTracks: 0 })
    .where(eq(playlists.id, playlist.id))
    .run();

  // Re-sync tracks from the repaired Spotify playlist into local DB
  const apiTracks = await spotify.getPlaylistTracks(repairedSpotifyId);
  playlistService.syncPlaylistTracksFromApi(repairedSpotifyId, apiTracks);
}
