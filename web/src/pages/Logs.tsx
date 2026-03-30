import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client.js";

interface LogEntry {
  time: string;
  type: string;
  status: string;
  detail: string;
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

const TYPE_BADGE_CLASS: Record<string, string> = {
  "Spotify Sync": "badge badge-green",
  Match: "badge badge-blue",
  Tag: "badge badge-yellow",
  Search: "badge badge-gray",
  Download: "badge badge-blue",
  Validate: "badge badge-yellow",
  Wishlist: "badge badge-gray",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusClass(status: string): string {
  if (status === "done") return "status-ok";
  if (status === "failed") return "status-fail";
  if (status === "running") return "status-running";
  return "";
}

const ALL_TYPES = Object.values(TYPE_LABELS);

export function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filterType, setFilterType] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const addEntry = useCallback((entry: LogEntry) => {
    setEntries((prev) => {
      const next = [...prev, entry];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  // Track whether user has scrolled away from bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      autoScrollRef.current = atBottom;
    };

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll when new entries arrive
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries]);

  // Subscribe to job events SSE
  useEffect(() => {
    const es = api.jobEvents();

    es.addEventListener("message", (e) => {
      try {
        const data = JSON.parse(e.data);
        const payload = data.payload ?? {};
        const detail = payload.title
          ? `${payload.artist ?? ""} \u2014 ${payload.title}`
          : payload.playlistName ?? data.jobId?.slice(0, 8) ?? "";

        addEntry({
          time: formatTime(new Date()),
          type: TYPE_LABELS[data.type] ?? data.type ?? "Job",
          status: data.status ?? "",
          detail,
        });
      } catch {
        // ignore malformed events
      }
    });

    return () => es.close();
  }, [addEntry]);

  const filtered = filterType
    ? entries.filter((e) => e.type === filterType)
    : entries;

  return (
    <>
      <div className="page-header">
        <h2>Logs</h2>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ width: 160 }}
        >
          <option value="">All types</option>
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="log-container" ref={containerRef}>
        {filtered.length === 0 && (
          <div className="text-muted" style={{ padding: "1rem 0" }}>
            No log entries yet. Events will appear here as sync and job operations run.
          </div>
        )}
        {filtered.map((entry, i) => (
          <div key={i} className="log-line">
            <span className="log-time">[{entry.time}]</span>
            <span
              className={`log-type ${TYPE_BADGE_CLASS[entry.type] ?? "badge badge-gray"}`}
            >
              {entry.type}
            </span>
            <span className={statusClass(entry.status)}>
              {entry.status}
            </span>
            {entry.detail && <span> {entry.detail}</span>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </>
  );
}
