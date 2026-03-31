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

  // Seed with recent jobs on mount
  useEffect(() => {
    api.getJobs().then((data) => {
      const jobs = (data.jobs ?? data) as Array<Record<string, unknown>>;
      const recent = jobs
        .filter((j) => j.startedAt || j.completedAt)
        .sort((a, b) => ((a.startedAt ?? a.createdAt) as number) - ((b.startedAt ?? b.createdAt) as number))
        .slice(-50);

      const seed: LogEntry[] = recent.map((j) => {
        const payload = j.payload && typeof j.payload === "object" ? j.payload as Record<string, string> : {};
        const result = j.result && typeof j.result === "object" ? j.result as Record<string, unknown> : {};
        const merged = { ...payload, ...result };
        const detail = jobDetail(merged, (j.id as string) ?? "");
        const ts = (j.completedAt ?? j.startedAt ?? j.createdAt) as number;
        return {
          time: formatTime(new Date(ts)),
          type: TYPE_LABELS[j.type as string] ?? (j.type as string) ?? "Job",
          status: j.status as string,
          detail,
        };
      });

      setEntries(seed);
    }).catch(() => {});
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

  // Subscribe to job events SSE (events are named: job-started, job-done, job-failed)
  useEffect(() => {
    const es = api.jobEvents();

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
        const detail = jobDetail(payload, data.jobId ?? "");

        addEntry({
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
