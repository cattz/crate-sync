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

      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "40%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Source Track</th>
              <th>Score</th>
              <th>Method</th>
              <th>Confidence</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {matches?.map((m) => (
              <tr key={m.id}>
                <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.sourceTrack ? `${m.sourceTrack.title} — ${m.sourceTrack.artist}` : m.sourceId}>
                  {m.sourceTrack ? (
                    <>
                      {m.sourceTrack.title} <span className="text-muted">— {m.sourceTrack.artist}</span>
                    </>
                  ) : (
                    <span className="text-muted">{m.sourceId}</span>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${
                      m.score >= 0.8
                        ? "badge-green"
                        : m.score >= 0.4
                          ? "badge-yellow"
                          : "badge-red"
                    }`}
                  >
                    {(m.score * 100).toFixed(0)}%
                  </span>
                </td>
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
