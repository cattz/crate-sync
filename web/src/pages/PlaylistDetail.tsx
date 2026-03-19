import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { usePlaylist, usePlaylistTracks, usePlaylists, useStartSync, useRenamePlaylist, useDeletePlaylist, usePushPlaylist, useRepairPlaylist, useMergePlaylists } from "../api/hooks.js";
import { api, type ReviewDecision, type Playlist } from "../api/client.js";

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
  const repair = useRepairPlaylist();

  const [syncId, setSyncId] = useState<string | null>(null);
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);
  const [syncPhase, setSyncPhase] = useState<string | null>(null);
  const [reviewItems, setReviewItems] = useState<
    Array<{ dbTrackId: string; title: string; artist: string; score: number }>
  >([]);
  const merge = useMergePlaylists();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [trackSearch, setTrackSearch] = useState("");
  const [trackSortKey, setTrackSortKey] = useState<TrackSortKey>("position");
  const [trackSortDir, setTrackSortDir] = useState<SortDir>("asc");

  // SSE listener
  useEffect(() => {
    if (!syncId) return;

    const es = api.syncEvents(syncId);

    const handler = (type: string) => (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setSyncEvents((prev) => [...prev, { type, data }]);

      if (type === "phase") setSyncPhase(data.phase);
      if (type === "review-needed") setReviewItems(data.items);
    };

    for (const evt of ["phase", "match-complete", "review-needed", "download-progress", "sync-complete", "error"]) {
      es.addEventListener(evt, handler(evt));
    }

    return () => es.close();
  }, [syncId]);

  const handleStartSync = useCallback(async () => {
    if (!id) return;
    setSyncEvents([]);
    setSyncPhase(null);
    setReviewItems([]);
    const result = await startSync.mutateAsync(id);
    setSyncId(result.syncId);
  }, [id, startSync]);

  const handleSubmitReview = useCallback(
    async (decisions: ReviewDecision[]) => {
      if (!syncId) return;
      await api.submitReview(syncId, decisions);
      setReviewItems([]);
    },
    [syncId],
  );

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
            onClick={() => repair.mutate(playlist.id)}
            disabled={repair.isPending}
          >
            {repair.isPending ? "Repairing..." : "Repair"}
          </button>
          <button onClick={() => setMergeOpen(true)}>
            Merge Into
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
          Push: {push.data.message ?? `${push.data.added} added, ${push.data.removed} removed${push.data.renamed ? ", renamed" : ""}`}
        </div>
      )}
      {push.isError && (
        <div className="text-sm" style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>
          Push failed: {push.error.message}
        </div>
      )}

      {/* Repair result */}
      {repair.isSuccess && (
        <div className="text-sm" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}>
          Repair: {repair.data.found} matched, {repair.data.needsReview} need review, {repair.data.notFound} not found ({repair.data.total} total)
        </div>
      )}
      {repair.isError && (
        <div className="text-sm" style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>
          Repair failed: {repair.error.message}
        </div>
      )}

      {/* Merge result */}
      {merge.isSuccess && (
        <div className="text-sm" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}>
          Merge: {merge.data.added} added, {merge.data.duplicatesSkipped} duplicates skipped
        </div>
      )}
      {merge.isError && (
        <div className="text-sm" style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>
          Merge failed: {merge.error.message}
        </div>
      )}

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

      {/* Review UI */}
      {reviewItems.length > 0 && (
        <div className="card mb-2">
          <h3 style={{ marginBottom: "0.4rem" }}>Review Matches</h3>
          <ReviewPanel items={reviewItems} onSubmit={handleSubmitReview} />
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
            placeholder="Filter by title or artist…"
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

      {/* Merge modal */}
      {mergeOpen && playlist && (
        <MergeModal
          targetId={playlist.id}
          onMerge={async (sourceIds) => {
            await merge.mutateAsync({ targetId: playlist.id, sourceIds });
            setMergeOpen(false);
          }}
          onClose={() => setMergeOpen(false)}
          isPending={merge.isPending}
        />
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
      {label} {active === sortKey ? (dir === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}

function ReviewPanel({
  items,
  onSubmit,
}: {
  items: Array<{ dbTrackId: string; title: string; artist: string; score: number }>;
  onSubmit: (decisions: ReviewDecision[]) => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});

  const toggle = (id: string, accepted: boolean) => {
    setDecisions((prev) => ({ ...prev, [id]: accepted }));
  };

  const handleSubmit = () => {
    const result: ReviewDecision[] = items.map((item) => ({
      dbTrackId: item.dbTrackId,
      accepted: decisions[item.dbTrackId] ?? false,
    }));
    onSubmit(result);
  };

  return (
    <>
      {items.map((item) => (
        <div
          key={item.dbTrackId}
          className="flex items-center justify-between"
          style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <span>{item.title}</span>
            <span className="text-muted"> — {item.artist}</span>
            <span className="badge badge-yellow" style={{ marginLeft: "0.5rem" }}>
              {(item.score * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex gap-1">
            <button
              className={decisions[item.dbTrackId] === true ? "primary" : ""}
              onClick={() => toggle(item.dbTrackId, true)}
            >
              Accept
            </button>
            <button
              className={decisions[item.dbTrackId] === false ? "danger" : ""}
              onClick={() => toggle(item.dbTrackId, false)}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
      <div style={{ marginTop: "0.75rem" }}>
        <button className="primary" onClick={handleSubmit}>
          Submit Decisions
        </button>
      </div>
    </>
  );
}

function MergeModal({
  targetId,
  onMerge,
  onClose,
  isPending,
}: {
  targetId: string;
  onMerge: (sourceIds: string[]) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const { data: allPlaylists } = usePlaylists();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const available = useMemo(() => {
    if (!allPlaylists) return [];
    let list = allPlaylists.filter((p) => p.id !== targetId);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [allPlaylists, targetId, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <h3 style={{ marginBottom: "0.5rem" }}>Merge Into This Playlist</h3>
        <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
          Select playlists whose tracks will be merged in. Duplicates are skipped.
        </p>
        <input
          type="text"
          placeholder="Filter playlists…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", marginBottom: "0.5rem" }}
          autoFocus
        />
        <div style={{ flex: 1, overflow: "auto", maxHeight: 300, border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
          {available.map((p) => (
            <label
              key={p.id}
              className="flex items-center"
              style={{
                padding: "0.35rem 0.5rem",
                cursor: "pointer",
                background: selected.has(p.id) ? "var(--bg-hover)" : "transparent",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                style={{ marginRight: "0.5rem" }}
              />
              <span>{p.name}</span>
              <span className="text-muted text-sm" style={{ marginLeft: "auto" }}>{p.trackCount} tracks</span>
            </label>
          ))}
          {available.length === 0 && (
            <div className="text-muted text-sm" style={{ padding: "0.5rem" }}>No playlists found.</div>
          )}
        </div>
        <div className="flex gap-1" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={isPending || selected.size === 0}
            onClick={() => onMerge([...selected])}
          >
            {isPending ? "Merging..." : `Merge ${selected.size} playlist${selected.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
