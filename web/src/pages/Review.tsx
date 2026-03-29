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

function ReviewCard({ item }: { item: PendingReviewItem }) {
  const confirm = useConfirmReview();
  const reject = useRejectReview();
  const isPending = confirm.isPending || reject.isPending;

  const score = (item.score * 100).toFixed(0);
  const src = item.spotifyTrack;
  const tgt = item.lexiconTrack;

  return (
    <div className="card">
      <div className="comparison-grid">
        <div className="comparison-panel">
          <h4>Spotify</h4>
          <div><Link to={`/tracks/${src.id}`}>{src.title}</Link></div>
          <div className="text-muted">{src.artist}</div>
          {src.album && <div className="text-muted">{src.album}</div>}
          <div className="text-muted text-sm">{formatDuration(src.durationMs)}</div>
          <span className="badge badge-blue" style={{ marginTop: "0.25rem" }}>{item.playlistName}</span>
        </div>
        <div className="comparison-panel">
          <h4>Lexicon</h4>
          <div>{tgt.title}</div>
          <div className="text-muted">{tgt.artist}</div>
          {tgt.album && <div className="text-muted">{tgt.album}</div>}
          <div className="text-muted text-sm">{formatDuration(tgt.durationMs)}</div>
          <div className="text-muted text-sm mono" style={{ marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {tgt.filePath}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1" style={{ marginTop: "0.5rem" }}>
        <span
          className={`badge ${
            item.confidence === "high" ? "badge-green" : item.confidence === "review" ? "badge-yellow" : "badge-red"
          }`}
        >
          {score}%
        </span>
        <span className="badge badge-gray">{item.method}</span>
        <span className="text-muted text-sm">{formatRelativeTime(item.parkedAt)}</span>
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
            Reject &amp; Queue Download
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
