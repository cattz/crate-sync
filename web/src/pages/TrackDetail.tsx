import { useParams, Link } from "react-router";
import { useTrackLifecycle, useTrackRejections } from "../api/hooks.js";

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
  queued: "badge-blue",
  running: "badge-yellow",
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

export function TrackDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useTrackLifecycle(id!);
  const { data: rejections } = useTrackRejections(id!);

  if (isLoading) return <p className="text-muted">Loading track...</p>;
  if (!data) return <p className="text-muted">Track not found.</p>;

  const { track, playlists, matches, downloads, jobs } = data;

  const matchRejections = (rejections ?? []).filter((r) => r.context === "lexicon_match");
  const downloadRejections = (rejections ?? []).filter((r) => r.context === "soulseek_download");

  return (
    <>
      <div className="page-header">
        <h2>{track.title}</h2>
      </div>

      {/* Track info */}
      <div className="card">
        <h3 style={{ marginBottom: "0.4rem" }}>Spotify Metadata</h3>
        <table>
          <tbody>
            <tr><td className="text-muted">Artist</td><td>{track.artist}</td></tr>
            <tr><td className="text-muted">Album</td><td>{track.album ?? "—"}</td></tr>
            <tr><td className="text-muted">Duration</td><td>{formatDuration(track.durationMs)}</td></tr>
            <tr><td className="text-muted">ISRC</td><td className="mono">{track.isrc ?? "—"}</td></tr>
            <tr><td className="text-muted">Spotify URI</td><td className="mono text-sm">{track.spotifyUri ?? "—"}</td></tr>
            <tr><td className="text-muted">Imported</td><td>{formatTime(track.createdAt)}</td></tr>
          </tbody>
        </table>
      </div>

      {/* Playlists */}
      <div className="card">
        <h3 style={{ marginBottom: "0.4rem" }}>Playlists ({playlists.length})</h3>
        {playlists.length === 0 ? (
          <p className="text-muted">Not in any playlist.</p>
        ) : (
          <table>
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
        <h3 style={{ marginBottom: "0.4rem" }}>Matches ({matches.length})</h3>
        {matches.length === 0 ? (
          <p className="text-muted">No matches found.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Target</th><th>Score</th><th>Method</th><th>Status</th></tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="text-muted text-sm">{m.targetType}:</span> {m.targetId.slice(0, 12)}
                  </td>
                  <td className="mono">{(m.score * 100).toFixed(0)}%</td>
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
        <h3 style={{ marginBottom: "0.4rem" }}>Downloads ({downloads.length})</h3>
        {downloads.length === 0 ? (
          <p className="text-muted">No downloads.</p>
        ) : (
          <table>
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
                  <td className="mono text-sm" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {d.filePath ?? d.soulseekPath ?? "—"}
                  </td>
                  <td>
                    <span className="badge badge-gray">{d.origin}</span>
                  </td>
                  <td className="text-sm" style={{ color: "var(--danger)" }}>
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
        <h3 style={{ marginBottom: "0.4rem" }}>Rejection History ({(rejections ?? []).length})</h3>
        {(!rejections || rejections.length === 0) ? (
          <p className="text-muted">No rejection history for this track.</p>
        ) : (
          <>
            <h4 className="text-muted" style={{ fontSize: "0.85rem", marginBottom: "0.3rem", marginTop: "0.3rem" }}>Match Rejections</h4>
            {matchRejections.length === 0 ? (
              <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>No match rejections.</p>
            ) : (
              <table style={{ marginBottom: "0.5rem" }}>
                <thead>
                  <tr><th>Target Track ID</th><th>Reason</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {matchRejections.map((r) => (
                    <tr key={r.id}>
                      <td className="mono text-sm">{r.targetTrackId?.slice(0, 12) ?? "—"}</td>
                      <td className="text-sm">{r.reason ?? "—"}</td>
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
              <table>
                <thead>
                  <tr><th>File Key</th><th>Reason</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {downloadRejections.map((r) => (
                    <tr key={r.id}>
                      <td className="mono text-sm" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.fileKey ?? "—"}
                      </td>
                      <td className="text-sm">{r.reason ?? "—"}</td>
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
          <h3 style={{ marginBottom: "0.4rem" }}>Jobs ({jobs.length})</h3>
          <table>
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
