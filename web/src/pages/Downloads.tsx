import { useState } from "react";
import { useDownloads, useWishlistRun, useClearDownloads } from "../api/hooks.js";

const statusBadge: Record<string, string> = {
  pending: "badge-gray",
  searching: "badge-blue",
  downloading: "badge-blue",
  validating: "badge-yellow",
  moving: "badge-yellow",
  done: "badge-green",
  failed: "badge-red",
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

export function Downloads() {
  const [filter, setFilter] = useState<string>("");
  const { data: downloads, isLoading } = useDownloads(filter || undefined);
  const wishlist = useWishlistRun();
  const clearDownloads = useClearDownloads();

  if (isLoading) return <p className="text-muted">Loading downloads...</p>;

  return (
    <>
      <div className="page-header">
        <h2>Downloads</h2>
        <div className="flex gap-1">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="downloading">Downloading</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </select>
          <button
            onClick={() => clearDownloads.mutate("done")}
            disabled={clearDownloads.isPending}
          >
            Clear Completed
          </button>
          <button
            onClick={() => clearDownloads.mutate("failed")}
            disabled={clearDownloads.isPending}
          >
            Clear Failed
          </button>
          <button
            onClick={() => wishlist.mutate()}
            disabled={wishlist.isPending}
          >
            {wishlist.isPending
              ? "Running..."
              : wishlist.isSuccess
                ? `Queued (job ${wishlist.data.jobId.slice(0, 8)})`
                : "Run Wishlist"}
          </button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Track</th>
              <th style={{ width: "1%" }}>Status</th>
              <th style={{ width: "1%" }}>Origin</th>
              <th>File</th>
              <th>Error</th>
              <th style={{ width: "1%" }}>Completed</th>
            </tr>
          </thead>
          <tbody>
            {downloads?.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.track ? (
                    <span className="inline-track">
                      {d.track.title} <span className="artist">— {d.track.artist}</span>
                    </span>
                  ) : (
                    <span className="text-muted">{d.trackId}</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${statusBadge[d.status] ?? "badge-gray"}`}>
                    {d.status}
                  </span>
                </td>
                <td>
                  <span className="badge badge-gray">{d.origin}</span>
                </td>
                <td className="text-muted text-sm mono col-truncate">
                  {d.filePath ?? "—"}
                </td>
                <td className="text-sm" style={{ color: d.error ? "var(--danger)" : undefined }}>
                  {d.error ? (
                    <span title={d.error}>
                      {d.error.length > 120 ? `${d.error.slice(0, 120)}...` : d.error}
                    </span>
                  ) : (
                    ""
                  )}
                </td>
                <td className="text-muted text-sm">{formatTime(d.completedAt)}</td>
              </tr>
            ))}
            {downloads?.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted">
                  No downloads.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
