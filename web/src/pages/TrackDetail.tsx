import { useState } from "react";
import { useParams, Link } from "react-router";
import { useTrackLifecycle, useTrackRejections, useSyncTrack } from "../api/hooks.js";
import type { SyncTrackResult } from "../api/client.js";
import { SpotifyPlayButton } from "../components/SpotifyPlayButton.js";

const matchStatusBadge: Record<string, string> = {
  pending: "badge-yellow",
  confirmed: "badge-green",
  rejected: "badge-red",
};

const dlStatusBadge: Record<string, string> = {
  pending: "badge-gray",
  searching: "badge-blue",
  downloading: "badge-blue",
  validating: "badge-yellow",
  moving: "badge-yellow",
  done: "badge-green",
  failed: "badge-red",
};

const jobStatusBadge: Record<string, string> = {
  queued: "badge-gray",
  running: "badge-blue",
  done: "badge-green",
  failed: "badge-red",
};

function formatDuration(ms: number | null | undefined) {
  if (!ms) return "—";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatTime(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const syncStatusBadge: Record<string, string> = {
  confirmed: "badge-green",
  pending: "badge-yellow",
  not_found: "badge-red",
};

const syncStatusLabel: Record<string, string> = {
  confirmed: "Matched",
  pending: "Pending review",
  not_found: "Not found",
};

export function TrackDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useTrackLifecycle(id!);
  const { data: rejections } = useTrackRejections(id!);
  const syncTrack = useSyncTrack();
  const [syncResult, setSyncResult] = useState<SyncTrackResult | null>(null);

  if (isLoading) return <p className="text-muted">Loading track...</p>;
  if (!data) return <p className="text-muted">Track not found.</p>;

  const { track, playlists, matches, downloads, jobs } = data;

  const matchRejections = (rejections ?? []).filter((r) => r.context === "lexicon_match");
  const downloadRejections = (rejections ?? []).filter((r) => r.context === "soulseek_download");

  const handleSync = () => {
    setSyncResult(null);
    syncTrack.mutate(id!, {
      onSuccess: (result) => setSyncResult(result),
    });
  };

  return (
    <>
      <div className="page-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SpotifyPlayButton type="track" spotifyId={track.spotifyId} size={18} />
          {track.title}
        </h2>
        <button
          onClick={handleSync}
          disabled={syncTrack.isPending}
        >
          {syncTrack.isPending ? "Syncing..." : "Sync with Lexicon"}
        </button>
      </div>

      {/* Sync result */}
      {syncTrack.isError && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <p style={{ color: "var(--danger)", margin: 0 }}>
            Sync failed: {syncTrack.error instanceof Error ? syncTrack.error.message : "Unknown error"}
          </p>
        </div>
      )}
      {syncResult && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className={`badge ${syncStatusBadge[syncResult.status] ?? "badge-gray"}`}>
              {syncStatusLabel[syncResult.status] ?? syncResult.status}
            </span>
            {syncResult.match && (
              <span className="text-sm text-muted">
                Score: {(syncResult.match.score * 100).toFixed(0)}% via {syncResult.match.method}
              </span>
            )}
            {syncResult.tagged && (
              <span className="badge badge-blue">Tagged</span>
            )}
          </div>
        </div>
      )}

      {/* Track info */}
      <div className="card">
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>Spotify Metadata</h3>
        <table style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: "80%" }} />
          </colgroup>
          <tbody>
            <tr><td className="text-muted">Artist</td><td>{track.artist}</td></tr>
            <tr><td className="text-muted">Album</td><td>{track.album ?? "—"}</td></tr>
            <tr><td className="text-muted">Duration</td><td>{formatDuration(track.durationMs)}</td></tr>
            <tr><td className="text-muted">ISRC</td><td className="mono">{track.isrc ?? "—"}</td></tr>
            <tr><td className="text-muted">Spotify URI</td><td className="mono text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={track.spotifyUri ?? ""}>{track.spotifyUri ?? "—"}</td></tr>
            <tr><td className="text-muted">Imported</td><td>{formatTime(track.createdAt)}</td></tr>
          </tbody>
        </table>
      </div>

      {/* Playlists */}
      <div className="card">
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>Playlists ({playlists.length})</h3>
        {playlists.length === 0 ? (
          <p className="text-muted">Not in any playlist.</p>
        ) : (
          <table style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "80%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr><th>Playlist</th><th>Position</th></tr>
            </thead>
            <tbody>
              {playlists.map((p) => (
                <tr key={p.playlistId}>
                  <td><Link to={`/playlists/${p.playlistId}`}>{p.playlistName}</Link></td>
                  <td>{p.position + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Matches */}
      <div className="card">
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>Matches ({matches.length})</h3>
        {matches.length === 0 ? (
          <p className="text-muted">No matches found.</p>
        ) : (
          <table style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "35%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <thead>
              <tr><th>Target</th><th>Score</th><th>Method</th><th>Status</th></tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${m.targetType}: ${m.targetId}`}>
                    <span className="text-muted text-sm">{m.targetType}:</span> {m.targetId.slice(0, 12)}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        m.score >= 0.8
                          ? "badge-green"
                          : m.score >= 0.4
                            ? "badge-yellow"
                            : "badge-red"
                      }`}
                    >
                      {(m.score * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td><span className="badge badge-gray">{m.method}</span></td>
                  <td>
                    <span className={`badge ${matchStatusBadge[m.status] ?? "badge-gray"}`}>
                      {m.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Downloads */}
      <div className="card">
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>Downloads ({downloads.length})</h3>
        {downloads.length === 0 ? (
          <p className="text-muted">No downloads.</p>
        ) : (
          <table style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "10%" }} />
              <col style={{ width: "35%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "25%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr><th>Status</th><th>File</th><th>Origin</th><th>Error</th><th>When</th></tr>
            </thead>
            <tbody>
              {downloads.map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className={`badge ${dlStatusBadge[d.status] ?? "badge-gray"}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="mono text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.filePath ?? d.soulseekPath ?? ""}>
                    {d.filePath ?? d.soulseekPath ?? "—"}
                  </td>
                  <td>
                    <span className="badge badge-gray">{d.origin}</span>
                  </td>
                  <td className="text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: d.error ? "var(--danger)" : undefined }} title={d.error ?? ""}>
                    {d.error ?? ""}
                  </td>
                  <td className="text-muted text-sm">{formatTime(d.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Rejection History */}
      <div className="card">
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>Rejection History ({(rejections ?? []).length})</h3>
        {(!rejections || rejections.length === 0) ? (
          <p className="text-muted">No rejection history for this track.</p>
        ) : (
          <>
            <h4 className="text-muted" style={{ fontSize: "0.85rem", marginBottom: "0.3rem", marginTop: "0.3rem" }}>Match Rejections</h4>
            {matchRejections.length === 0 ? (
              <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>No match rejections.</p>
            ) : (
              <table style={{ tableLayout: "fixed", marginBottom: "0.5rem" }}>
                <colgroup>
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "50%" }} />
                  <col style={{ width: "25%" }} />
                </colgroup>
                <thead>
                  <tr><th>Target Track ID</th><th>Reason</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {matchRejections.map((r) => (
                    <tr key={r.id}>
                      <td className="mono text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.targetTrackId ?? ""}>{r.targetTrackId?.slice(0, 12) ?? "—"}</td>
                      <td className="text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason ?? ""}>{r.reason ?? "—"}</td>
                      <td className="text-muted text-sm">{formatTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h4 className="text-muted" style={{ fontSize: "0.85rem", marginBottom: "0.3rem" }}>Download Rejections</h4>
            {downloadRejections.length === 0 ? (
              <p className="text-muted text-sm">No download rejections.</p>
            ) : (
              <table style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "30%" }} />
                  <col style={{ width: "45%" }} />
                  <col style={{ width: "25%" }} />
                </colgroup>
                <thead>
                  <tr><th>File Key</th><th>Reason</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {downloadRejections.map((r) => (
                    <tr key={r.id}>
                      <td className="mono text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.fileKey ?? ""}>
                        {r.fileKey ?? "—"}
                      </td>
                      <td className="text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason ?? ""}>{r.reason ?? "—"}</td>
                      <td className="text-muted text-sm">{formatTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* Jobs */}
      {jobs.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.4rem" }}>Jobs ({jobs.length})</h3>
          <table style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "15%" }} />
              <col style={{ width: "25%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "25%" }} />
            </colgroup>
            <thead>
              <tr><th>ID</th><th>Type</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link to={`/queue/${j.id}`} className="mono text-sm">
                      {j.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td><span className="badge badge-gray">{j.type}</span></td>
                  <td>
                    <span className={`badge ${jobStatusBadge[j.status] ?? "badge-gray"}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="text-muted text-sm">{formatTime(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
