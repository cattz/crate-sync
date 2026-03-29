import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { usePlaylist, usePlaylistTracks, usePlaylists, useStartSync, useRenamePlaylist, useDeletePlaylist, usePushPlaylist, useUpdatePlaylistMeta } from "../api/hooks.js";
import { api } from "../api/client.js";

function formatDuration(ms: number) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatTotalDuration(ms: number, count: number) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return `${parts.join(" ")} across ${count} tracks`;
}

type TrackSortKey = "position" | "title" | "artist" | "album" | "durationMs";
type SortDir = "asc" | "desc";

interface SyncEvent {
  type: string;
  data: Record<string, unknown>;
}

export function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: playlist, isLoading: playlistLoading } = usePlaylist(id!);
  const { data: tracks, isLoading: tracksLoading } = usePlaylistTracks(id!);
  const startSync = useStartSync();

  const navigate = useNavigate();
  const rename = useRenamePlaylist();
  const del = useDeletePlaylist();
  const push = usePushPlaylist();
  const updateMeta = useUpdatePlaylistMeta();
  const { data: allPlaylists } = usePlaylists();

  const [syncId, setSyncId] = useState<string | null>(null);
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);
  const [syncPhase, setSyncPhase] = useState<string | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [trackSearch, setTrackSearch] = useState("");
  const [trackSortKey, setTrackSortKey] = useState<TrackSortKey>("position");
  const [trackSortDir, setTrackSortDir] = useState<SortDir>("asc");
  const [notesValue, setNotesValue] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  // SSE listener
  useEffect(() => {
    if (!syncId) return;

    const es = api.syncEvents(syncId);

    const handler = (type: string) => (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setSyncEvents((prev) => [...prev, { type, data }]);

      if (type === "phase") setSyncPhase(data.phase);
    };

    for (const evt of ["phase", "match-complete", "download-progress", "sync-complete", "error"]) {
      es.addEventListener(evt, handler(evt));
    }

    return () => es.close();
  }, [syncId]);

  const handleStartSync = useCallback(async () => {
    if (!id) return;
    setSyncEvents([]);
    setSyncPhase(null);
    const result = await startSync.mutateAsync(id);
    setSyncId(result.syncId);
  }, [id, startSync]);

  function handleTrackSort(key: TrackSortKey) {
    if (key === trackSortKey) {
      setTrackSortDir(trackSortDir === "asc" ? "desc" : "asc");
    } else {
      setTrackSortKey(key);
      setTrackSortDir("asc");
    }
  }

  const filteredTracks = useMemo(() => {
    if (!tracks) return [];
    let list = tracks;

    if (trackSearch) {
      const q = trackSearch.toLowerCase();
      list = list.filter(
        (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
      );
    }

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (trackSortKey === "position") {
        cmp = (a.position ?? 0) - (b.position ?? 0);
      } else if (trackSortKey === "title") {
        cmp = a.title.localeCompare(b.title);
      } else if (trackSortKey === "artist") {
        cmp = a.artist.localeCompare(b.artist);
      } else if (trackSortKey === "album") {
        cmp = (a.album ?? "").localeCompare(b.album ?? "");
      } else {
        cmp = a.durationMs - b.durationMs;
      }
      return trackSortDir === "asc" ? cmp : -cmp;
    });
  }, [tracks, trackSearch, trackSortKey, trackSortDir]);

  const totalDurationMs = useMemo(
    () => (tracks ?? []).reduce((sum, t) => sum + t.durationMs, 0),
    [tracks],
  );

  // Tag helpers
  const currentTags: string[] = useMemo(() => {
    if (!playlist?.tags) return [];
    try { return JSON.parse(playlist.tags); } catch { return []; }
  }, [playlist?.tags]);

  const allExistingTags = useMemo(() => {
    if (!allPlaylists) return [];
    const tagSet = new Set<string>();
    for (const p of allPlaylists) {
      if (p.tags) {
        try {
          for (const t of JSON.parse(p.tags)) tagSet.add(t);
        } catch { /* ignore */ }
      }
    }
    return [...tagSet].sort();
  }, [allPlaylists]);

  const tagSuggestions = useMemo(() => {
    if (!tagInput) return [];
    const q = tagInput.toLowerCase();
    return allExistingTags.filter(
      (t) => t.toLowerCase().includes(q) && !currentTags.includes(t),
    );
  }, [tagInput, allExistingTags, currentTags]);

  const handleAddTag = useCallback((tag: string) => {
    if (!id || !tag.trim()) return;
    const trimmed = tag.trim().toLowerCase();
    if (currentTags.includes(trimmed)) return;
    const newTags = [...currentTags, trimmed];
    updateMeta.mutate({ id, meta: { tags: newTags } });
    setTagInput("");
    setShowTagSuggestions(false);
  }, [id, currentTags, updateMeta]);

  const handleRemoveTag = useCallback((tag: string) => {
    if (!id) return;
    const newTags = currentTags.filter((t) => t !== tag);
    updateMeta.mutate({ id, meta: { tags: newTags } });
  }, [id, currentTags, updateMeta]);

  const handleTogglePin = useCallback(() => {
    if (!id || !playlist) return;
    updateMeta.mutate({ id, meta: { pinned: !playlist.pinned } });
  }, [id, playlist, updateMeta]);

  const handleSaveNotes = useCallback((value: string) => {
    if (!id) return;
    updateMeta.mutate({ id, meta: { notes: value } });
  }, [id, updateMeta]);

  if (playlistLoading || tracksLoading) return <p className="text-muted">Loading...</p>;
  if (!playlist) return <p className="text-muted">Playlist not found</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/playlists" className="text-muted text-sm">
            &larr; Playlists
          </Link>
          <h2 style={{ marginTop: "0.25rem" }}>{playlist.name}</h2>
          <span className="text-muted text-sm">{playlist.trackCount} tracks</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleTogglePin}
            disabled={updateMeta.isPending}
          >
            {playlist.pinned ? "Unpin" : "Pin"}
          </button>
          <button className="primary" onClick={handleStartSync} disabled={startSync.isPending || !!syncPhase}>
            {syncPhase ? `Syncing (${syncPhase})...` : "Start Sync"}
          </button>
          <button
            onClick={() => push.mutate(playlist.id)}
            disabled={push.isPending || playlist.isOwned === 0 || !playlist.spotifyId}
          >
            {push.isPending ? "Pushing..." : "Push to Spotify"}
          </button>
          <button
            onClick={() => { setNewName(playlist.name); setRenameOpen(true); }}
            disabled={playlist.isOwned === 0}
          >
            Rename
          </button>
          <button
            className="danger"
            onClick={() => setDeleteOpen(true)}
            disabled={playlist.isOwned === 0}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Push result */}
      {push.isSuccess && (
        <div className="text-sm" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}>
          Push: {push.data.message ?? `${push.data.added} added, ${push.data.removed} removed${push.data.renamed ? ", renamed" : ""}${push.data.descriptionUpdated ? ", description updated" : ""}`}
        </div>
      )}
      {push.isError && (
        <div className="text-sm" style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>
          Push failed: {push.error.message}
        </div>
      )}

      {/* Tags */}
      <div className="card mb-2">
        <h3 style={{ marginBottom: "0.3rem" }}>Tags</h3>
        <div className="flex items-center gap-1" style={{ flexWrap: "wrap", marginBottom: "0.35rem" }}>
          {currentTags.map((tag) => (
            <span key={tag} className="badge badge-blue" style={{ cursor: "pointer" }} onClick={() => handleRemoveTag(tag)} title="Click to remove">
              {tag} &times;
            </span>
          ))}
          {currentTags.length === 0 && <span className="text-muted text-sm">No tags</span>}
        </div>
        <div style={{ position: "relative", maxWidth: 260 }}>
          <input
            type="text"
            placeholder="Add tag\u2026"
            value={tagInput}
            onChange={(e) => { setTagInput(e.target.value); setShowTagSuggestions(true); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag(tagInput);
              }
            }}
            onFocus={() => setShowTagSuggestions(true)}
            onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
            style={{ width: "100%" }}
          />
          {showTagSuggestions && tagSuggestions.length > 0 && (
            <div style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              zIndex: 10,
              maxHeight: 150,
              overflowY: "auto",
            }}>
              {tagSuggestions.map((s) => (
                <div
                  key={s}
                  style={{ padding: "0.25rem 0.5rem", cursor: "pointer" }}
                  onMouseDown={(e) => { e.preventDefault(); handleAddTag(s); }}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="card mb-2">
        <h3 style={{ marginBottom: "0.3rem" }}>Notes</h3>
        <textarea
          style={{
            width: "100%",
            minHeight: 80,
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "0.4rem 0.6rem",
            fontFamily: "var(--font)",
            fontSize: "0.85rem",
            resize: "vertical",
          }}
          value={notesValue ?? playlist.notes ?? ""}
          onChange={(e) => setNotesValue(e.target.value)}
          onBlur={() => {
            const val = notesValue ?? "";
            if (val !== (playlist.notes ?? "")) {
              handleSaveNotes(val);
            }
          }}
          placeholder="Add notes about this playlist\u2026"
        />
      </div>

      {/* Sync progress */}
      {syncEvents.length > 0 && (
        <div className="card mb-2">
          <h3 style={{ marginBottom: "0.3rem" }}>Sync Progress</h3>
          {syncEvents.map((evt, i) => (
            <div key={i} className="text-sm" style={{ padding: "0.2rem 0" }}>
              <span className="badge badge-blue" style={{ marginRight: "0.5rem" }}>
                {evt.type}
              </span>
              <span className="text-muted mono">{JSON.stringify(evt.data)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Track list */}
      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: "0.5rem" }}>
          <span className="text-muted text-sm">
            {formatTotalDuration(totalDurationMs, tracks?.length ?? 0)}
          </span>
          <input
            type="text"
            placeholder="Filter by title or artist\u2026"
            value={trackSearch}
            onChange={(e) => setTrackSearch(e.target.value)}
            style={{ width: 220 }}
          />
        </div>
        <table>
          <thead>
            <tr>
              <ThSort label="#" sortKey="position" active={trackSortKey} dir={trackSortDir} onSort={handleTrackSort} />
              <ThSort label="Title" sortKey="title" active={trackSortKey} dir={trackSortDir} onSort={handleTrackSort} />
              <ThSort label="Artist" sortKey="artist" active={trackSortKey} dir={trackSortDir} onSort={handleTrackSort} />
              <ThSort label="Album" sortKey="album" active={trackSortKey} dir={trackSortDir} onSort={handleTrackSort} />
              <ThSort label="Duration" sortKey="durationMs" active={trackSortKey} dir={trackSortDir} onSort={handleTrackSort} />
            </tr>
          </thead>
          <tbody>
            {filteredTracks.map((t, i) => (
              <tr key={t.id} onClick={() => navigate(`/tracks/${t.id}`)} style={{ cursor: "pointer" }}>
                <td className="text-muted">{(t.position ?? i) + 1}</td>
                <td>{t.title}</td>
                <td className="text-muted">{t.artist}</td>
                <td className="text-muted">{t.album ?? ""}</td>
                <td className="text-muted mono text-sm">{formatDuration(t.durationMs)}</td>
              </tr>
            ))}
            {filteredTracks.length === 0 && tracks && tracks.length > 0 && (
              <tr>
                <td colSpan={5} className="text-muted">No tracks match your filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Rename modal */}
      {renameOpen && (
        <div className="modal-overlay" onClick={() => setRenameOpen(false)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "0.5rem" }}>Rename Playlist</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim() || newName.trim() === playlist.name) return;
              await rename.mutateAsync({ id: playlist.id, name: newName.trim() });
              setRenameOpen(false);
            }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ width: "100%", marginBottom: "0.5rem" }}
                autoFocus
              />
              <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setRenameOpen(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={rename.isPending || !newName.trim() || newName.trim() === playlist.name}>
                  {rename.isPending ? "Renaming..." : "Rename"}
                </button>
              </div>
              {rename.isError && <p style={{ color: "var(--danger)", marginTop: "0.3rem" }}>{rename.error.message}</p>}
            </form>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteOpen && (
        <div className="modal-overlay" onClick={() => setDeleteOpen(false)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "0.5rem" }}>Delete Playlist</h3>
            <p style={{ marginBottom: "0.5rem" }}>
              Delete <strong>{playlist.name}</strong> ({playlist.trackCount} tracks) from the local database?
            </p>
            <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
              This does not delete the playlist from Spotify.
            </p>
            <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button className="danger" disabled={del.isPending} onClick={async () => {
                await del.mutateAsync(playlist.id);
                navigate("/playlists");
              }}>
                {del.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
            {del.isError && <p style={{ color: "var(--danger)", marginTop: "0.3rem" }}>{del.error.message}</p>}
          </div>
        </div>
      )}
    </>
  );
}

function ThSort({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: TrackSortKey;
  active: TrackSortKey;
  dir: SortDir;
  onSort: (key: TrackSortKey) => void;
}) {
  return (
    <th onClick={() => onSort(sortKey)} style={{ cursor: "pointer", userSelect: "none" }}>
      {label} {active === sortKey ? (dir === "asc" ? "\u25B2" : "\u25BC") : ""}
    </th>
  );
}
