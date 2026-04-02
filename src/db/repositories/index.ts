import type { getDb } from "../client.js";
import { DrizzlePlaylistRepository } from "./playlist-repository.js";
import { DrizzleTrackRepository } from "./track-repository.js";
import { DrizzlePlaylistTrackRepository } from "./playlist-track-repository.js";
import { DrizzleMatchRepository } from "./match-repository.js";
import { DrizzleDownloadRepository } from "./download-repository.js";
import { DrizzleRejectionRepository } from "./rejection-repository.js";

export {
  DrizzlePlaylistRepository,
  DrizzleTrackRepository,
  DrizzlePlaylistTrackRepository,
  DrizzleMatchRepository,
  DrizzleDownloadRepository,
  DrizzleRejectionRepository,
};

export interface Repositories {
  playlists: DrizzlePlaylistRepository;
  tracks: DrizzleTrackRepository;
  playlistTracks: DrizzlePlaylistTrackRepository;
  matches: DrizzleMatchRepository;
  downloads: DrizzleDownloadRepository;
  rejections: DrizzleRejectionRepository;
}

/** Create all repository instances from a single DB connection. */
export function createRepositories(db: ReturnType<typeof getDb>): Repositories {
  return {
    playlists: new DrizzlePlaylistRepository(db),
    tracks: new DrizzleTrackRepository(db),
    playlistTracks: new DrizzlePlaylistTrackRepository(db),
    matches: new DrizzleMatchRepository(db),
    downloads: new DrizzleDownloadRepository(db),
    rejections: new DrizzleRejectionRepository(db),
  };
}
