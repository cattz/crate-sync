import { useState, useEffect, useCallback } from "react";
import { Outlet, NavLink } from "react-router";
import { useStatus, useReviewStats } from "./api/hooks.js";
import { api } from "./api/client.js";

interface LogLine {
  time: string;
  type: string;
  status: string;
  detail: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const TYPE_LABELS: Record<string, string> = {
  spotify_sync: "Spotify Sync",
  lexicon_match: "Match",
  lexicon_tag: "Tag",
  search: "Search",
  download: "Download",
  validate: "Validate",
  wishlist_run: "Wishlist",
};

/** Build a human-readable detail string from job payload/result fields. */
function jobDetail(p: Record<string, unknown>, jobId: string): string {
  if (p.title) {
    return `${(p.artist as string) ?? ""} — ${p.title as string}`;
  }
  if (p.playlistName) {
    let detail = p.playlistName as string;
    if (p.confirmed !== undefined) {
      detail += ` — ${p.confirmed} matched`;
      if (p.notFound) detail += `, ${p.notFound} not found`;
    }
    return detail;
  }
  return jobId.slice(0, 8);
}

function StatusBar() {
  const [lines, setLines] = useState<LogLine[]>([]);

  const addLine = useCallback((line: LogLine) => {
    setLines((prev) => [...prev.slice(-2), line]);
  }, []);

  useEffect(() => {
    const es = api.jobEvents();

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
        const detail = jobDetail(payload, data.jobId ?? "");

        addLine({
          time: formatTime(new Date()),
          type: TYPE_LABELS[data.jobType] ?? TYPE_LABELS[data.type] ?? data.jobType ?? data.type ?? "Job",
          status: data.status ?? "",
          detail,
        });
      } catch {
        // ignore malformed events
      }
    };

    for (const evt of ["job-started", "job-done", "job-failed"]) {
      es.addEventListener(evt, handleEvent);
    }

    return () => es.close();
  }, [addLine]);

  if (lines.length === 0) return null;

  return (
    <div className="status-bar">
      {lines.map((line, i) => (
        <div key={i} className="status-line">
          <span className="status-time">{line.time}</span>
          <span className="status-type">{line.type}</span>
          <span className={
            line.status === "done" ? "status-ok" :
            line.status === "failed" ? "status-fail" :
            line.status === "running" ? "status-running" : ""
          }>
            {line.status}
          </span>
          {line.detail && <span> {line.detail}</span>}
        </div>
      ))}
    </div>
  );
}

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
  const { data: reviewStats } = useReviewStats();

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
            {reviewStats && reviewStats.pending > 0 && (
              <span className="badge badge-yellow review-badge">{reviewStats.pending}</span>
            )}
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
          <NavLink to="/logs" className={({ isActive }) => (isActive ? "active" : "")}>
            Logs
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
      <StatusBar />
    </div>
  );
}
