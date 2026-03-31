import { useState } from "react";
import { useStatus, usePlaylists, useReviewStats, useDownloads, useJobStats, useRecentDownloads, useStartSpotifyLogin, useSpotifyAuthStatus, useSpotifyLogout, useConnectSoulseek, useDisconnectSoulseek } from "../api/hooks.js";
import type { RecentDownload } from "../api/client.js";

export function Dashboard() {
  const { data: status, isLoading: statusLoading } = useStatus();
  const { data: playlists } = usePlaylists();
  const { data: reviewStats } = useReviewStats();
  const { data: recentDownloads } = useDownloads();
  const { data: jobStats } = useJobStats();
  const { data: recentlyAdded } = useRecentDownloads();

  if (statusLoading) return <p className="text-muted">Loading...</p>;

  const activeDownloads = (recentDownloads ?? []).filter(
    (d) => d.status === "downloading" || d.status === "searching",
  ).length;

  return (
    <>
      <h2>Dashboard</h2>

      <div className="grid-stats">
        <div className="stat-card">
          <div className="label">Playlists</div>
          <div className="value">{playlists?.length ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Tracks</div>
          <div className="value">{status?.database.ok ? status.database.tracks : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pending Reviews</div>
          <div className="value">{reviewStats?.pending ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Active Downloads</div>
          <div className="value">{activeDownloads}</div>
        </div>
        <div className="stat-card">
          <div className="label">Queued Jobs</div>
          <div className="value">{jobStats?.byStatus.queued ?? 0}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.4rem" }}>Service Status</h3>
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
              <SpotifyRow status={status.spotify} />
              <ServiceRow name="Lexicon" status={status.lexicon} />
              <SoulseekRow status={status.soulseek} />
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

      <RecentlyAddedCard items={recentlyAdded ?? []} />
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

function SpotifyRow({ status }: { status: { ok: boolean; error?: string } }) {
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState("");

  const startLogin = useStartSpotifyLogin();
  const { data: authStatus } = useSpotifyAuthStatus(polling);
  const logout = useSpotifyLogout();

  // Stop polling once authenticated
  if (polling && authStatus?.authenticated) {
    setPolling(false);
  }

  const handleLogin = async () => {
    setError("");
    try {
      const result = await startLogin.mutateAsync();
      if (!result.ok) {
        setError(result.error ?? "Failed to start login");
        return;
      }
      if (result.authUrl) {
        window.open(result.authUrl, "_blank", "noopener");
        setPolling(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start login");
    }
  };

  const handleLogout = async () => {
    await logout.mutateAsync();
  };

  return (
    <>
      <tr>
        <td>Spotify</td>
        <td>
          <span className={`badge ${status.ok ? "badge-green" : "badge-red"}`}>
            {status.ok ? "Connected" : "Error"}
          </span>
        </td>
        <td className="text-muted text-sm">
          <span style={{ marginRight: "0.5rem" }}>
            {polling ? "Waiting for authorization..." : (status.error ?? "")}
          </span>
          {status.ok ? (
            <button
              className="danger"
              style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
              onClick={handleLogout}
              disabled={logout.isPending}
            >
              Logout
            </button>
          ) : !polling ? (
            <button
              className="primary"
              style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
              onClick={handleLogin}
              disabled={startLogin.isPending}
            >
              {startLogin.isPending ? "Starting..." : "Login"}
            </button>
          ) : null}
          {error && (
            <span style={{ color: "var(--danger)", fontSize: "0.75rem", marginLeft: "0.5rem" }}>{error}</span>
          )}
        </td>
      </tr>
    </>
  );
}

function SoulseekRow({ status }: { status: { ok: boolean; error?: string } }) {
  const [showForm, setShowForm] = useState(false);
  const [slskdUrl, setSlskdUrl] = useState("http://localhost:5030");
  const [slskdApiKey, setSlskdApiKey] = useState("");
  const [error, setError] = useState("");

  const connect = useConnectSoulseek();
  const disconnect = useDisconnectSoulseek();

  const handleConnect = async () => {
    setError("");
    try {
      const result = await connect.mutateAsync({ slskdUrl, slskdApiKey });
      if (!result.ok) {
        setError(result.error ?? "Connection failed");
        return;
      }
      setShowForm(false);
      setSlskdApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  };

  const handleDisconnect = async () => {
    await disconnect.mutateAsync();
  };

  return (
    <>
      <tr>
        <td>Soulseek</td>
        <td>
          <span className={`badge ${status.ok ? "badge-green" : "badge-red"}`}>
            {status.ok ? "Connected" : "Error"}
          </span>
        </td>
        <td className="text-muted text-sm">
          <span style={{ marginRight: "0.5rem" }}>{status.error ?? ""}</span>
          {status.ok ? (
            <button
              className="danger"
              style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              Disconnect
            </button>
          ) : (
            <button
              className="primary"
              style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
              onClick={() => setShowForm(!showForm)}
            >
              {showForm ? "Cancel" : "Connect"}
            </button>
          )}
        </td>
      </tr>
      {showForm && (
        <tr>
          <td colSpan={3} style={{ padding: "0.5rem 0.6rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label className="text-muted" style={{ fontSize: "0.7rem", display: "block" }}>slskd URL</label>
                <input
                  type="text"
                  value={slskdUrl}
                  onChange={(e) => setSlskdUrl(e.target.value)}
                  placeholder="http://localhost:5030"
                  style={{ width: 200, marginTop: "0.15rem" }}
                />
              </div>
              <div>
                <label className="text-muted" style={{ fontSize: "0.7rem", display: "block" }}>API Key</label>
                <input
                  type="password"
                  value={slskdApiKey}
                  onChange={(e) => setSlskdApiKey(e.target.value)}
                  placeholder="slskd API key"
                  style={{ width: 200, marginTop: "0.15rem" }}
                />
              </div>
              <button
                className="primary"
                onClick={handleConnect}
                disabled={connect.isPending || !slskdApiKey}
              >
                {connect.isPending ? "Connecting..." : "Connect"}
              </button>
            </div>
            {error && (
              <div style={{ color: "var(--danger)", fontSize: "0.75rem", marginTop: "0.35rem" }}>{error}</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Recently Added to Lexicon
// ---------------------------------------------------------------------------

function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function RecentlyAddedCard({ items }: { items: RecentDownload[] }) {
  const display = items.slice(0, 20);

  return (
    <div className="card">
      <h3 style={{ marginBottom: "0.4rem" }}>Recently Added to Lexicon</h3>
      {display.length === 0 ? (
        <p className="text-muted">No tracks added yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Artist</th>
              <th>Title</th>
              <th>Playlist</th>
            </tr>
          </thead>
          <tbody>
            {display.map((d) => (
              <tr key={d.id}>
                <td className="text-muted text-sm" style={{ whiteSpace: "nowrap" }}>
                  {timeAgo(d.completedAt)}
                </td>
                <td>{d.trackArtist}</td>
                <td>{d.trackTitle}</td>
                <td className="text-muted text-sm">{d.playlistName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
