import { useParams, Link } from "react-router";
import { useTrackLifecycle } from "../api/hooks.js";

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
  if (!ms) return "\u2014";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatTime(ms: number | null) {
  if (!ms) return "\u2014";
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

  if (isLoading) return <p className="text-muted">Loading track...</p>;
  if (!data) return <p className="text-muted">Track not found.</p>;

  const { track, playlists, matches, downloads, jobs } = data;

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
            <tr><td className="text-muted">Album</td><td>{track.album ?? "\u2014"}</td></tr>
            <tr><td className="text-muted">Duration</td><td>{formatDuration(track.durationMs)}</td></tr>
            <tr><td className="text-muted">ISRC</td><td className="mono">{track.isrc ?? "\u2014"}</td></tr>
            <tr><td className="text-muted">Spotify URI</td><td className="mono text-sm">{track.spotifyUri ?? "\u2014"}</td></tr>
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
              <tr><th>Status</th><th>File</th><th>Error</th><th>When</th></tr>
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
                    {d.filePath ?? d.soulseekPath ?? "\u2014"}
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
