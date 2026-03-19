import { useParams, Link } from "react-router";
import { useJob, useRetryJob } from "../api/hooks.js";

const statusBadge: Record<string, string> = {
  queued: "badge-blue",
  running: "badge-yellow",
  done: "badge-green",
  failed: "badge-red",
};

const typeLabel: Record<string, string> = {
  spotify_sync: "Spotify Sync",
  match: "Match",
  search: "Search",
  download: "Download",
  validate: "Validate",
  lexicon_sync: "Lexicon Sync",
  wishlist_scan: "Wishlist",
};

function formatTime(ms: number | null) {
  if (!ms) return "\u2014";
  return new Date(ms).toLocaleString();
}

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: job, isLoading } = useJob(id!);
  const retryJob = useRetryJob();

  if (isLoading) return <p className="text-muted">Loading job...</p>;
  if (!job) return <p className="text-muted">Job not found.</p>;

  return (
    <>
      <div className="page-header">
        <h2>
          Job {job.id.slice(0, 8)}{" "}
          <span className={`badge ${statusBadge[job.status] ?? "badge-gray"}`}>
            {job.status}
          </span>
        </h2>
        <div className="flex gap-1">
          {job.status === "failed" && (
            <button
              onClick={() => retryJob.mutate(job.id)}
              disabled={retryJob.isPending}
            >
              Retry
            </button>
          )}
          <Link to="/queue">Back to Queue</Link>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.4rem" }}>Overview</h3>
        <table>
          <tbody>
            <tr>
              <td className="text-muted">Type</td>
              <td>
                <span className="badge badge-gray">
                  {typeLabel[job.type] ?? job.type}
                </span>
              </td>
            </tr>
            <tr>
              <td className="text-muted">Priority</td>
              <td>{job.priority}</td>
            </tr>
            <tr>
              <td className="text-muted">Attempt</td>
              <td>
                {job.attempt} / {job.maxAttempts}
              </td>
            </tr>
            <tr>
              <td className="text-muted">Created</td>
              <td>{formatTime(job.createdAt)}</td>
            </tr>
            <tr>
              <td className="text-muted">Started</td>
              <td>{formatTime(job.startedAt)}</td>
            </tr>
            <tr>
              <td className="text-muted">Completed</td>
              <td>{formatTime(job.completedAt)}</td>
            </tr>
            {job.parentJobId && (
              <tr>
                <td className="text-muted">Parent</td>
                <td>
                  <Link to={`/queue/${job.parentJobId}`} className="mono text-sm">
                    {job.parentJobId.slice(0, 8)}
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {job.error && (
        <div className="card" style={{ borderLeft: "3px solid var(--danger)" }}>
          <h3 style={{ marginBottom: "0.3rem", color: "var(--danger)" }}>Error</h3>
          <pre className="text-sm" style={{ whiteSpace: "pre-wrap" }}>
            {job.error}
          </pre>
        </div>
      )}

      {job.payload && (
        <div className="card">
          <h3 style={{ marginBottom: "0.3rem" }}>Payload</h3>
          <pre className="text-sm mono" style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(job.payload, null, 2)}
          </pre>
        </div>
      )}

      {job.result && (
        <div className="card">
          <h3 style={{ marginBottom: "0.3rem" }}>Result</h3>
          <pre className="text-sm mono" style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </div>
      )}

      {job.children && job.children.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: "0.4rem" }}>
            Child Jobs ({job.children.length})
          </h3>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {job.children.map((child) => (
                <tr key={child.id}>
                  <td>
                    <Link to={`/queue/${child.id}`} className="mono text-sm">
                      {child.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <span className="badge badge-gray">
                      {typeLabel[child.type] ?? child.type}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${statusBadge[child.status] ?? "badge-gray"}`}>
                      {child.status}
                    </span>
                  </td>
                  <td className="text-muted text-sm">
                    {formatTime(child.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
