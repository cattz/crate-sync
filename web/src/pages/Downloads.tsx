import { useState, useEffect } from "react";
import { useDownloads, useWishlistRun, useClearDownloads, useDeleteDownloadFile, useCleanEmptyDirs, useRescueOrphanDownloads } from "../api/hooks.js";
import { api } from "../api/client.js";
import type { DownloadWithTrack } from "../api/client.js";

const statusBadge: Record<string, string> = {
  pending: "badge-gray",
  searching: "badge-blue",
  downloading: "badge-blue",
  validating: "badge-yellow",
  moving: "badge-yellow",
  done: "badge-green",
  failed: "badge-red",
  wishlisted: "badge-yellow",
};

interface DownloadProgress {
  username: string;
  filename: string;
  percentComplete: number;
  speed: number;
  bytesTransferred: number;
  size: number;
}

function formatTime(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1_000_000) {
    return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1_000).toFixed(0)} KB/s`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * Hook to listen for download-progress SSE events.
 * Returns a map of "username\0filename" -> progress data.
 */
function useDownloadProgress() {
  const [progress, setProgress] = useState<Map<string, DownloadProgress>>(new Map());

  useEffect(() => {
    const es = api.jobEvents();

    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const p = data.payload;
        if (!p?.username || !p?.filename) return;
        const key = `${p.username}\0${p.filename}`;
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(key, {
            username: p.username,
            filename: p.filename,
            percentComplete: p.percentComplete ?? 0,
            speed: p.speed ?? 0,
            bytesTransferred: p.bytesTransferred ?? 0,
            size: p.size ?? 0,
          });
          return next;
        });
      } catch {
        // ignore malformed events
      }
    };

    es.addEventListener("download-progress", handler);

    return () => {
      es.removeEventListener("download-progress", handler);
      es.close();
    };
  }, []);

  return progress;
}

/** Find progress data for a download row by matching slskd username+filename. */
function findProgress(
  d: DownloadWithTrack,
  progressMap: Map<string, DownloadProgress>,
): DownloadProgress | undefined {
  // Direct lookup by username+filename key (most reliable)
  if (d.slskdUsername && d.slskdFilename) {
    const key = `${d.slskdUsername}\0${d.slskdFilename}`;
    const direct = progressMap.get(key);
    if (direct) return direct;
  }

  // Fallback: check by filename match if soulseekPath is set
  if (!d.slskdFilename && !d.soulseekPath) return undefined;

  const needle = d.slskdFilename ?? d.soulseekPath ?? "";
  for (const [, p] of progressMap) {
    if (p.filename === needle) return p;
  }
  return undefined;
}

function DownloadRow({
  d,
  progressMap,
  onDeleteFile,
  isDeleting,
}: {
  d: DownloadWithTrack;
  progressMap: Map<string, DownloadProgress>;
  onDeleteFile: (id: string) => void;
  isDeleting: boolean;
}) {
  const progress = d.status === "downloading" ? findProgress(d, progressMap) : undefined;

  return (
    <tr>
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
        {progress && (
          <div style={{ marginTop: 4 }}>
            <div className="progress-bar" style={{ width: "100%" }}>
              <div className="fill" style={{ width: `${Math.min(progress.percentComplete, 100)}%` }} />
            </div>
            <div className="text-muted text-sm" style={{ marginTop: 2, fontSize: "0.7rem" }}>
              {progress.percentComplete.toFixed(0)}%
              {progress.speed > 0 && ` \u00b7 ${formatSpeed(progress.speed)}`}
              {progress.size > 0 && ` \u00b7 ${formatSize(progress.bytesTransferred)}/${formatSize(progress.size)}`}
            </div>
          </div>
        )}
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
            className="danger"
            onClick={() => onDeleteFile(d.id)}
            disabled={isDeleting}
            title="Delete file from disk"
          >
            Delete File
          </button>
        )}
      </td>
    </tr>
  );
}

export function Downloads() {
  const [filter, setFilter] = useState<string>("");
  const { data: downloads, isLoading } = useDownloads(filter || undefined);
  const wishlist = useWishlistRun();
  const clearDownloads = useClearDownloads();
  const deleteFile = useDeleteDownloadFile();
  const cleanDirs = useCleanEmptyDirs();
  const rescue = useRescueOrphanDownloads();
  const progressMap = useDownloadProgress();

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
            onClick={() => rescue.mutate()}
            disabled={rescue.isPending}
          >
            {rescue.isPending
              ? "Rescuing..."
              : rescue.isSuccess
                ? `Queued (job ${rescue.data.jobId.slice(0, 8)})`
                : "Rescue Orphans"}
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
            <col style={{ width: "12%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "20%" }} />
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
              <DownloadRow
                key={d.id}
                d={d}
                progressMap={progressMap}
                onDeleteFile={(id) => deleteFile.mutate(id)}
                isDeleting={deleteFile.isPending}
              />
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
