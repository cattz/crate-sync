import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router";
import { usePlaylist, usePlaylistTracks, useStartSync } from "../api/hooks.js";
import { api, type ReviewDecision } from "../api/client.js";

function formatDuration(ms: number) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

interface SyncEvent {
  type: string;
  data: Record<string, unknown>;
}

export function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: playlist, isLoading: playlistLoading } = usePlaylist(id!);
  const { data: tracks, isLoading: tracksLoading } = usePlaylistTracks(id!);
  const startSync = useStartSync();

  const [syncId, setSyncId] = useState<string | null>(null);
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);
  const [syncPhase, setSyncPhase] = useState<string | null>(null);
  const [reviewItems, setReviewItems] = useState<
    Array<{ dbTrackId: string; title: string; artist: string; score: number }>
  >([]);

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
        </div>
      </div>

      {/* Sync progress */}
      {syncEvents.length > 0 && (
        <div className="card mb-2">
          <h3 style={{ marginBottom: "0.5rem" }}>Sync Progress</h3>
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
          <h3 style={{ marginBottom: "0.75rem" }}>Review Matches</h3>
          <ReviewPanel items={reviewItems} onSubmit={handleSubmitReview} />
        </div>
      )}

      {/* Track list */}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Artist</th>
              <th>Album</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {tracks?.map((t, i) => (
              <tr key={t.id}>
                <td className="text-muted">{(t.position ?? i) + 1}</td>
                <td>{t.title}</td>
                <td className="text-muted">{t.artist}</td>
                <td className="text-muted">{t.album ?? ""}</td>
                <td className="text-muted mono text-sm">{formatDuration(t.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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
