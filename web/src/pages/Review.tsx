import { useMatches, useUpdateMatch } from "../api/hooks.js";
import type { MatchWithTrack } from "../api/client.js";
import { Link } from "react-router";

function formatDuration(ms: number | null | undefined) {
  if (!ms) return "\u2014";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function MatchRow({ match }: { match: MatchWithTrack }) {
  const updateMatch = useUpdateMatch();
  const src = match.sourceTrack;
  const tgt = match.targetTrack;
  const score = (match.score * 100).toFixed(0);

  return (
    <tr>
      <td>
        <span
          className={`badge ${
            match.confidence === "high" ? "badge-green" : match.confidence === "review" ? "badge-yellow" : "badge-red"
          }`}
        >
          {score}%
        </span>
      </td>
      <td>
        <span className="badge badge-gray">{match.method}</span>
      </td>
      <td>
        {src ? (
          <span className="inline-track">
            <Link to={`/tracks/${src.id}`}>{src.title}</Link> <span className="artist">— {src.artist}</span>
            {src.album && <span className="artist"> [{src.album}]</span>}
          </span>
        ) : (
          <span className="text-muted mono text-sm">{match.sourceId}</span>
        )}
      </td>
      <td className="text-muted text-sm mono">{src ? formatDuration(src.durationMs) : "\u2014"}</td>
      <td>
        {tgt ? (
          <span className="inline-track">
            {tgt.title} <span className="artist">— {tgt.artist}</span>
            {tgt.album && <span className="artist"> [{tgt.album}]</span>}
          </span>
        ) : (
          <span className="text-muted mono text-sm">{match.targetId}</span>
        )}
      </td>
      <td className="text-muted text-sm mono">{tgt ? formatDuration(tgt.durationMs) : "\u2014"}</td>
      <td>
        <div className="flex gap-1">
          <button
            onClick={() => updateMatch.mutate({ id: match.id, status: "confirmed" })}
            disabled={updateMatch.isPending}
          >
            Confirm
          </button>
          <button
            className="danger"
            onClick={() => updateMatch.mutate({ id: match.id, status: "rejected" })}
            disabled={updateMatch.isPending}
          >
            Reject
          </button>
        </div>
      </td>
    </tr>
  );
}

export function Review() {
  const { data: pendingMatches, isLoading } = useMatches("pending");
  const updateMatch = useUpdateMatch();

  if (isLoading) return <p className="text-muted">Loading pending matches...</p>;

  const matches = pendingMatches ?? [];

  function confirmAll() {
    for (const m of matches) {
      updateMatch.mutate({ id: m.id, status: "confirmed" });
    }
  }

  function rejectAll() {
    for (const m of matches) {
      updateMatch.mutate({ id: m.id, status: "rejected" });
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>Review ({matches.length})</h2>
        {matches.length > 0 && (
          <div className="flex gap-1">
            <button onClick={confirmAll} disabled={updateMatch.isPending}>
              Confirm All
            </button>
            <button className="danger" onClick={rejectAll} disabled={updateMatch.isPending}>
              Reject All
            </button>
          </div>
        )}
      </div>

      {matches.length === 0 ? (
        <div className="card">
          <p className="text-muted">No pending matches to review.</p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Score</th>
                <th>Method</th>
                <th>Spotify Track</th>
                <th>Dur.</th>
                <th>Lexicon Track</th>
                <th>Dur.</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <MatchRow key={m.id} match={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
