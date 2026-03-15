import { useStatus, usePlaylists, useMatches, useDownloads } from "../api/hooks.js";

export function Dashboard() {
  const { data: status, isLoading: statusLoading } = useStatus();
  const { data: playlists } = usePlaylists();
  const { data: pendingMatches } = useMatches("pending");
  const { data: recentDownloads } = useDownloads();

  if (statusLoading) return <p className="text-muted">Loading...</p>;

  return (
    <>
      <h2>Dashboard</h2>

      <div className="grid-stats">
        <div className="stat-card">
          <div className="label">Playlists</div>
          <div className="value">{playlists?.length ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Tracks</div>
          <div className="value">{status?.database.ok ? status.database.tracks : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pending Matches</div>
          <div className="value">{pendingMatches?.length ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Downloads</div>
          <div className="value">{recentDownloads?.length ?? 0}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.75rem" }}>Service Status</h3>
        {status && (
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              <ServiceRow name="Spotify" status={status.spotify} />
              <ServiceRow name="Lexicon" status={status.lexicon} />
              <ServiceRow name="Soulseek" status={status.soulseek} />
              <ServiceRow
                name="Database"
                status={status.database}
                detail={
                  status.database.ok
                    ? `${status.database.playlists} playlists, ${status.database.tracks} tracks`
                    : undefined
                }
              />
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ServiceRow({
  name,
  status,
  detail,
}: {
  name: string;
  status: { ok: boolean; error?: string };
  detail?: string;
}) {
  return (
    <tr>
      <td>{name}</td>
      <td>
        <span className={`badge ${status.ok ? "badge-green" : "badge-red"}`}>
          {status.ok ? "Connected" : "Error"}
        </span>
      </td>
      <td className="text-muted text-sm">{detail ?? status.error ?? ""}</td>
    </tr>
  );
}
