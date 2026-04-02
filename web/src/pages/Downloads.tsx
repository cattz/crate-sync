import { useState } from "react";
import { useDownloads, useWishlistRun, useClearDownloads, useDeleteDownloadFile, useCleanEmptyDirs } from "../api/hooks.js";

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
  const deleteFile = useDeleteDownloadFile();
  const cleanDirs = useCleanEmptyDirs();

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
            onClick={() => cleanDirs.mutate()}
            disabled={cleanDirs.isPending}
          >
            {cleanDirs.isPending
              ? "Cleaning..."
              : cleanDirs.isSuccess
                ? `Removed ${cleanDirs.data.removed} dirs`
                : "Clean Empty Dirs"}
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

      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Track</th>
              <th>Status</th>
              <th>Origin</th>
              <th>File</th>
              <th>Error</th>
              <th>Completed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {downloads?.map((d) => (
              <tr key={d.id}>
                <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.track ? `${d.track.artist} — ${d.track.title}` : d.trackId}>
                  {d.track ? (
                    <>
                      {d.track.title} <span className="text-muted">— {d.track.artist}</span>
                    </>
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
                <td className="text-muted text-sm mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.filePath ?? ""}>
                  {d.filePath ?? "—"}
                </td>
                <td className="text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: d.error ? "var(--danger)" : undefined }} title={d.error ?? ""}>
                  {d.error ?? ""}
                </td>
                <td className="text-muted text-sm">{formatTime(d.completedAt)}</td>
                <td>
                  {d.status === "failed" && (d.soulseekPath || d.filePath) && (
                    <button
                      className="btn-sm btn-danger"
                      onClick={() => deleteFile.mutate(d.id)}
                      disabled={deleteFile.isPending}
                      title="Delete file from disk"
                    >
                      Delete File
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {downloads?.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted">
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
