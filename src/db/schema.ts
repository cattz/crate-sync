import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const uuid = () => crypto.randomUUID();
const now = () => Date.now();

const id = text("id")
  .primaryKey()
  .$defaultFn(uuid);

const createdAt = integer("created_at")
  .notNull()
  .$defaultFn(now);

const updatedAt = integer("updated_at")
  .notNull()
  .$defaultFn(now)
  .$onUpdateFn(now);

// ---------------------------------------------------------------------------
// playlists
// ---------------------------------------------------------------------------
export const playlists = sqliteTable("playlists", {
  id,
  spotifyId: text("spotify_id").unique(),
  name: text("name").notNull(),
  description: text("description"),
  snapshotId: text("snapshot_id"),
  lastSynced: integer("last_synced"),
  createdAt,
  updatedAt,
});

// ---------------------------------------------------------------------------
// tracks
// ---------------------------------------------------------------------------
export const tracks = sqliteTable("tracks", {
  id,
  spotifyId: text("spotify_id").unique(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  album: text("album"),
  durationMs: integer("duration_ms").notNull(),
  isrc: text("isrc"),
  spotifyUri: text("spotify_uri"),
  createdAt,
  updatedAt,
});

// ---------------------------------------------------------------------------
// playlist_tracks
// ---------------------------------------------------------------------------
export const playlistTracks = sqliteTable(
  "playlist_tracks",
  {
    id,
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlists.id),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    position: integer("position").notNull(),
    addedAt: integer("added_at"),
  },
  (table) => [
    uniqueIndex("playlist_track_uniq").on(table.playlistId, table.trackId),
  ],
);

// ---------------------------------------------------------------------------
// lexicon_tracks
// ---------------------------------------------------------------------------
export const lexiconTracks = sqliteTable("lexicon_tracks", {
  id,
  filePath: text("file_path").unique().notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  album: text("album"),
  durationMs: integer("duration_ms"),
  lastSynced: integer("last_synced").notNull(),
});

// ---------------------------------------------------------------------------
// matches
// ---------------------------------------------------------------------------
export const matches = sqliteTable("matches", {
  id,
  sourceType: text("source_type", { enum: ["spotify", "soulseek", "file"] }).notNull(),
  sourceId: text("source_id").notNull(),
  targetType: text("target_type", { enum: ["spotify", "lexicon", "soulseek"] }).notNull(),
  targetId: text("target_id").notNull(),
  score: real("score").notNull(),
  confidence: text("confidence", { enum: ["high", "review", "low"] }).notNull(),
  method: text("method", { enum: ["isrc", "fuzzy", "manual"] }).notNull(),
  status: text("status", { enum: ["pending", "confirmed", "rejected"] }).notNull(),
  createdAt,
  updatedAt,
});

// ---------------------------------------------------------------------------
// downloads
// ---------------------------------------------------------------------------
export const downloads = sqliteTable("downloads", {
  id,
  trackId: text("track_id")
    .notNull()
    .references(() => tracks.id),
  playlistId: text("playlist_id").references(() => playlists.id),
  status: text("status", {
    enum: ["pending", "searching", "downloading", "validating", "moving", "done", "failed"],
  }).notNull(),
  soulseekPath: text("soulseek_path"),
  filePath: text("file_path"),
  error: text("error"),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  createdAt,
});

// ---------------------------------------------------------------------------
// sync_log
// ---------------------------------------------------------------------------
export const syncLog = sqliteTable("sync_log", {
  id,
  playlistId: text("playlist_id").references(() => playlists.id),
  action: text("action").notNull(),
  details: text("details"),
  createdAt,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Playlist = InferSelectModel<typeof playlists>;
export type NewPlaylist = InferInsertModel<typeof playlists>;

export type Track = InferSelectModel<typeof tracks>;
export type NewTrack = InferInsertModel<typeof tracks>;

export type PlaylistTrack = InferSelectModel<typeof playlistTracks>;
export type NewPlaylistTrack = InferInsertModel<typeof playlistTracks>;

export type LexiconTrack = InferSelectModel<typeof lexiconTracks>;
export type NewLexiconTrack = InferInsertModel<typeof lexiconTracks>;

export type Match = InferSelectModel<typeof matches>;
export type NewMatch = InferInsertModel<typeof matches>;

export type Download = InferSelectModel<typeof downloads>;
export type NewDownload = InferInsertModel<typeof downloads>;

export type SyncLogEntry = InferSelectModel<typeof syncLog>;
export type NewSyncLogEntry = InferInsertModel<typeof syncLog>;
