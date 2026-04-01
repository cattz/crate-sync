import { useReviewPending, useConfirmReview, useRejectReview, useBulkConfirmReviews, useBulkRejectReviews } from "../api/hooks.js";
import type { PendingReviewItem } from "../api/client.js";
import { Link } from "react-router";

function formatDuration(ms: number | null | undefined) {
  if (!ms) return "—";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatRelativeTime(ms: number) {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Simple normalized string similarity (bigram overlap / Dice coefficient). */
function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const na = a.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const nb = b.toLowerCase().replace(/[^\w\s]/g, "").trim();
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const bigrams = (s: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      set.set(bg, (set.get(bg) ?? 0) + 1);
    }
    return set;
  };
  const bg1 = bigrams(na);
  const bg2 = bigrams(nb);
  let overlap = 0;
  for (const [k, v] of bg1) overlap += Math.min(v, bg2.get(k) ?? 0);
  return (2 * overlap) / (na.length - 1 + nb.length - 1);
}

/** Duration similarity: 1.0 if identical, 0.0 if > 30s apart. */
function durationSimilarity(a: number | null | undefined, b: number | null | undefined): number {
  if (!a || !b) return 0;
  const diffSec = Math.abs(a - b) / 1000;
  if (diffSec <= 2) return 1;
  if (diffSec >= 30) return 0;
  return 1 - (diffSec - 2) / 28;
}

function simColor(sim: number): string {
  if (sim >= 0.8) return "var(--accent)";     // green
  if (sim >= 0.4) return "var(--warning)";     // orange
  return "var(--danger)";                       // red
}

const cellStyle = (sim: number): React.CSSProperties => ({
  padding: "0.2rem 0.5rem",
  borderLeft: `3px solid ${simColor(sim)}`,
  fontSize: "0.85rem",
});

const labelStyle: React.CSSProperties = {
  padding: "0.2rem 0.5rem",
  fontSize: "0.75rem",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
  width: 60,
};

function ReviewCard({ item }: { item: PendingReviewItem }) {
  const confirm = useConfirmReview();
  const reject = useRejectReview();
  const isPending = confirm.isPending || reject.isPending;

  const score = (item.score * 100).toFixed(0);
  const src = item.spotifyTrack;
  const tgt = item.lexiconTrack;

  const titleSim = stringSimilarity(src.title, tgt.title);
  const artistSim = stringSimilarity(src.artist, tgt.artist);
  const albumSim = stringSimilarity(src.album ?? "", tgt.album ?? "");
  const durSim = durationSimilarity(src.durationMs, tgt.durationMs);

  return (
    <div className="card" style={{ padding: "0.5rem 0.75rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...labelStyle, width: 65 }}></th>
            <th style={{ ...labelStyle, textAlign: "left", fontWeight: 500 }}>Spotify</th>
            <th style={{ ...labelStyle, textAlign: "left", fontWeight: 500 }}>Lexicon</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={labelStyle}>Title</td>
            <td style={cellStyle(titleSim)}>
              <Link to={`/tracks/${src.id}`}>{src.title}</Link>
            </td>
            <td style={cellStyle(titleSim)}>{tgt.title}</td>
          </tr>
          <tr>
            <td style={labelStyle}>Artist</td>
            <td style={cellStyle(artistSim)}>{src.artist}</td>
            <td style={cellStyle(artistSim)}>{tgt.artist}</td>
          </tr>
          <tr>
            <td style={labelStyle}>Album</td>
            <td style={cellStyle(albumSim)}>{src.album ?? "—"}</td>
            <td style={cellStyle(albumSim)}>{tgt.album ?? "—"}</td>
          </tr>
          <tr>
            <td style={labelStyle}>Dur.</td>
            <td style={cellStyle(durSim)}>{formatDuration(src.durationMs)}</td>
            <td style={cellStyle(durSim)}>{formatDuration(tgt.durationMs)}</td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-center gap-1" style={{ marginTop: "0.35rem" }}>
        <span
          className={`badge ${
            item.confidence === "high" ? "badge-green" : item.confidence === "review" ? "badge-yellow" : "badge-red"
          }`}
        >
          {score}%
        </span>
        <span className="badge badge-gray">{item.method}</span>
        <span className="text-muted text-sm">{formatRelativeTime(item.parkedAt)}</span>
        <span className="badge badge-blue" style={{ fontSize: "0.7rem" }}>{item.playlistName}</span>
        <div style={{ marginLeft: "auto" }} className="flex gap-1">
          <button
            className="primary"
            onClick={() => confirm.mutate(item.matchId)}
            disabled={isPending}
          >
            Confirm
          </button>
          <button
            className="danger"
            onClick={() => reject.mutate(item.matchId)}
            disabled={isPending}
          >
            Reject & Download
          </button>
        </div>
      </div>
    </div>
  );
}

export function Review() {
  const { data: pendingItems, isLoading } = useReviewPending();
  const bulkConfirm = useBulkConfirmReviews();
  const bulkReject = useBulkRejectReviews();

  if (isLoading) return <p className="text-muted">Loading pending matches...</p>;

  const items = pendingItems ?? [];
  const allIds = items.map((i) => i.matchId);
  const anyPending = bulkConfirm.isPending || bulkReject.isPending;

  return (
    <>
      <div className="page-header">
        <h2>Review ({items.length})</h2>
        {items.length > 0 && (
          <div className="flex gap-1">
            <button
              className="primary"
              onClick={() => bulkConfirm.mutate(allIds)}
              disabled={anyPending}
            >
              Confirm All
            </button>
            <button
              className="danger"
              onClick={() => bulkReject.mutate(allIds)}
              disabled={anyPending}
            >
              Reject All
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card">
          <p className="text-muted">No pending matches to review.</p>
        </div>
      ) : (
        items.map((item) => (
          <ReviewCard key={item.matchId} item={item} />
        ))
      )}
    </>
  );
}
