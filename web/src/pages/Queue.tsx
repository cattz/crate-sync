import { useState } from "react";
import { useJobs, useJobStats, useRetryJob, useCancelJob, useRetryAllJobs, useClearJobs } from "../api/hooks.js";
import type { JobItem } from "../api/client.js";
import { Link } from "react-router";

const statusBadge: Record<string, string> = {
  queued: "badge-blue",
  running: "badge-yellow",
  done: "badge-green",
  failed: "badge-red",
};

const typeLabel: Record<string, string> = {
  spotify_sync: "Spotify Sync",
  lexicon_match: "Lexicon Match",
  lexicon_tag: "Lexicon Tag",
  search: "Search",
  download: "Download",
  validate: "Validate",
  wishlist_run: "Wishlist",
};

function formatTime(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function JobRow({ job }: { job: JobItem }) {
  const retryJob = useRetryJob();
  const cancelJob = useCancelJob();

  const payload = job.payload;
  const trackInfo =
    payload && (payload.title || payload.artist)
      ? `${payload.artist ?? ""} — ${payload.title ?? ""}`
      : null;

  return (
    <tr>
      <td>
        <Link to={`/queue/${job.id}`} className="mono text-sm">
          {job.id.slice(0, 8)}
        </Link>
      </td>
      <td>
        <span className="badge badge-gray">
          {typeLabel[job.type] ?? job.type}
        </span>
      </td>
      <td>
        <span className={`badge ${statusBadge[job.status] ?? "badge-gray"}`}>
          {job.status}
        </span>
      </td>
      <td className="text-sm">
        {trackInfo && <span className="inline-track">{trackInfo}</span>}
        {job.attempt > 0 && (
          <span className="text-muted" style={{ marginLeft: trackInfo ? "0.5rem" : 0 }}>
            {job.attempt}/{job.maxAttempts}
          </span>
        )}
      </td>
      <td className="text-sm" style={{ color: "var(--danger)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
        {job.error ? job.error.slice(0, 60) : ""}
      </td>
      <td className="text-muted text-sm">{formatTime(job.createdAt)}</td>
      <td>
        <div className="flex gap-1">
          {job.status === "failed" && (
            <button
              onClick={() => retryJob.mutate(job.id)}
              disabled={retryJob.isPending}
            >
              Retry
            </button>
          )}
          {job.status === "queued" && (
            <button
              className="danger"
              onClick={() => cancelJob.mutate(job.id)}
              disabled={cancelJob.isPending}
            >
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function Queue() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const { data, isLoading } = useJobs({
    status: statusFilter || undefined,
    type: typeFilter || undefined,
    limit: 50,
  });
  const { data: stats } = useJobStats();
  const retryAll = useRetryAllJobs();
  const clearJobs = useClearJobs();

  if (isLoading) return <p className="text-muted">Loading jobs...</p>;

  const jobs = data?.jobs ?? [];

  return (
    <>
      <div className="page-header">
        <h2>Job Queue</h2>
        <div className="flex gap-1">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            <option value="spotify_sync">Spotify Sync</option>
            <option value="lexicon_match">Lexicon Match</option>
            <option value="lexicon_tag">Lexicon Tag</option>
            <option value="search">Search</option>
            <option value="download">Download</option>
            <option value="validate">Validate</option>
            <option value="wishlist_run">Wishlist</option>
          </select>
          <button
            onClick={() => clearJobs.mutate("done")}
            disabled={clearJobs.isPending}
          >
            Clear Done
          </button>
          <button
            onClick={() => clearJobs.mutate("failed")}
            disabled={clearJobs.isPending}
          >
            Clear Failed
          </button>
          {statusFilter === "failed" && (
            <button
              onClick={() => retryAll.mutate(typeFilter || undefined)}
              disabled={retryAll.isPending}
            >
              Retry All{retryAll.data ? ` (${retryAll.data.retried})` : ""}
            </button>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid-stats">
          <div className="stat-card">
            <div className="label">Queued</div>
            <div className="value">{stats.byStatus.queued ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="label">Running</div>
            <div className="value">{stats.byStatus.running ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="label">Done</div>
            <div className="value">{stats.byStatus.done ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="label">Failed</div>
            <div className="value">{stats.byStatus.failed ?? 0}</div>
          </div>
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th style={{ width: "1%" }}>ID</th>
              <th style={{ width: "1%" }}>Type</th>
              <th style={{ width: "1%" }}>Status</th>
              <th>Details</th>
              <th>Error</th>
              <th style={{ width: "1%" }}>Created</th>
              <th style={{ width: "1%" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted">
                  No jobs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > jobs.length && (
        <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
          Showing {jobs.length} of {data.total} jobs.
        </p>
      )}
    </>
  );
}
