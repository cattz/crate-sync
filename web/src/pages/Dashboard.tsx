import { useState } from "react";
import { useStatus, usePlaylists, usePlaylistStats, useMatches, useDownloads, useJobStats, useStartSpotifyLogin, useSpotifyAuthStatus, useSpotifyLogout, useConnectSoulseek, useDisconnectSoulseek } from "../api/hooks.js";

export function Dashboard() {
  const { data: status, isLoading: statusLoading } = useStatus();
  const { data: playlists } = usePlaylists();
  const { data: pendingMatches } = useMatches("pending");
  const { data: recentDownloads } = useDownloads();
  const { data: jobStats } = useJobStats();
  const { data: libraryStats } = usePlaylistStats();

  if (statusLoading) return <p className="text-muted">Loading...</p>;

  return (
    <>
      <h2>Dashboard</h2>

      <div className="grid-stats">
        <div className="stat-card">
          <div className="label">Playlists</div>
          <div className="value">{libraryStats?.totalPlaylists ?? playlists?.length ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Tracks</div>
          <div className="value">{libraryStats?.totalTracks ?? (status?.database.ok ? status.database.tracks : "\u2014")}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Duration</div>
          <div className="value">{libraryStats ? formatLibraryDuration(libraryStats.totalDurationMs) : "\u2014"}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pending Matches</div>
          <div className="value">{pendingMatches?.length ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Downloads</div>
          <div className="value">{recentDownloads?.length ?? 0}</div>
        </div>
        {jobStats && (
          <>
            <div className="stat-card">
              <div className="label">Jobs Running</div>
              <div className="value">{jobStats.byStatus.running ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="label">Jobs Failed</div>
              <div className="value">{jobStats.byStatus.failed ?? 0}</div>
            </div>
          </>
        )}
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
    </>
  );
}

function formatLibraryDuration(ms: number) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
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
