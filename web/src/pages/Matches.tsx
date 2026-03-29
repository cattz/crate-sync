import { useState } from "react";
import { useMatches } from "../api/hooks.js";

export function Matches() {
  const [filter, setFilter] = useState<string>("");
  const { data: matches, isLoading } = useMatches(filter || undefined);

  if (isLoading) return <p className="text-muted">Loading matches...</p>;

  return (
    <>
      <div className="page-header">
        <h2>Matches</h2>
        <div className="flex gap-1">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Source Track</th>
              <th className="col-sm">Score</th>
              <th className="col-sm">Method</th>
              <th className="col-sm">Confidence</th>
              <th className="col-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {matches?.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.sourceTrack ? (
                    <span className="inline-track">
                      {m.sourceTrack.title} <span className="artist">— {m.sourceTrack.artist}</span>
                    </span>
                  ) : (
                    <span className="text-muted">{m.sourceId}</span>
                  )}
                </td>
                <td className="mono">{(m.score * 100).toFixed(0)}%</td>
                <td>
                  <span className="badge badge-gray">{m.method}</span>
                </td>
                <td>
                  <span
                    className={`badge ${
                      m.confidence === "high"
                        ? "badge-green"
                        : m.confidence === "review"
                          ? "badge-yellow"
                          : "badge-red"
                    }`}
                  >
                    {m.confidence}
                  </span>
                </td>
                <td>
                  <span
                    className={`badge ${
                      m.status === "confirmed"
                        ? "badge-green"
                        : m.status === "rejected"
                          ? "badge-red"
                          : "badge-yellow"
                    }`}
                  >
                    {m.status}
                  </span>
                </td>
              </tr>
            ))}
            {matches?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  No matches found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
