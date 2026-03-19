import { Outlet, NavLink } from "react-router";
import { useStatus } from "./api/hooks.js";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? "#1db954" : "#e74c3c",
        marginRight: 6,
      }}
    />
  );
}

export function App() {
  const { data: status } = useStatus();

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Crate Sync</h1>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Dashboard
          </NavLink>
          <NavLink to="/playlists" className={({ isActive }) => (isActive ? "active" : "")}>
            Playlists
          </NavLink>
          <NavLink to="/review" className={({ isActive }) => (isActive ? "active" : "")}>
            Review
          </NavLink>
          <NavLink to="/matches" className={({ isActive }) => (isActive ? "active" : "")}>
            Matches
          </NavLink>
          <NavLink to="/downloads" className={({ isActive }) => (isActive ? "active" : "")}>
            Downloads
          </NavLink>
          <NavLink to="/queue" className={({ isActive }) => (isActive ? "active" : "")}>
            Queue
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
            Settings
          </NavLink>
        </nav>

        {status && (
          <div style={{ padding: "0.75rem 1rem", marginTop: "auto", fontSize: "0.75rem" }}>
            <div className="text-muted" style={{ fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem", fontSize: "0.7rem" }}>
              Services
            </div>
            <div><StatusDot ok={status.spotify.ok} /> Spotify</div>
            <div><StatusDot ok={status.lexicon.ok} /> Lexicon</div>
            <div><StatusDot ok={status.soulseek.ok} /> Soulseek</div>
            <div><StatusDot ok={status.database.ok} /> Database</div>
          </div>
        )}
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
