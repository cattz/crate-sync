import { useState } from "react";
import { useDownloads } from "../api/hooks.js";

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

  if (isLoading) return <p className="text-muted">Loading downloads...</p>;

  return (
    <>
      <div className="page-header">
        <h2>Downloads</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="downloading">Downloading</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Track</th>
              <th>Status</th>
              <th>File</th>
              <th>Error</th>
              <th>Completed</th>
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
                <td className="text-muted text-sm mono" style={{ maxWidth: 350, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.filePath ?? "—"}
                </td>
                <td className="text-sm" style={{ color: "var(--danger)" }}>
                  {d.error ?? ""}
                </td>
                <td className="text-muted text-sm">{formatTime(d.completedAt)}</td>
              </tr>
            ))}
            {downloads?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
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
