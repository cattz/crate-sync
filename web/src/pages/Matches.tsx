import { useState } from "react";
import { useMatches, useUpdateMatch } from "../api/hooks.js";

export function Matches() {
  const [filter, setFilter] = useState<string>("");
  const { data: matches, isLoading } = useMatches(filter || undefined);
  const updateMatch = useUpdateMatch();

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
              <th>Score</th>
              <th>Method</th>
              <th>Confidence</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {matches?.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.sourceTrack ? (
                    <>
                      <div>{m.sourceTrack.title}</div>
                      <div className="text-muted text-sm">{m.sourceTrack.artist}</div>
                    </>
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
                <td>
                  {m.status === "pending" && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => updateMatch.mutate({ id: m.id, status: "confirmed" })}
                        disabled={updateMatch.isPending}
                      >
                        Confirm
                      </button>
                      <button
                        className="danger"
                        onClick={() => updateMatch.mutate({ id: m.id, status: "rejected" })}
                        disabled={updateMatch.isPending}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {matches?.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted">
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
