import { useState, useMemo } from "react";
import { useWishlist, useRemoveFromWishlist, useRetryWishlistItem, useWishlistRun } from "../api/hooks.js";
import type { WishlistItem } from "../api/client.js";
import { useMultiSelect } from "../hooks/useMultiSelect.js";
import { BulkToolbar } from "../components/BulkToolbar.js";

function formatTime(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(ms: number | null): string {
  if (!ms) return "—";
  const diff = ms - Date.now();
  if (diff <= 0) return "overdue";
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  const mins = Math.floor(diff / 60_000);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function WishlistRow({
  item,
  isSelected,
  onToggle,
  onRetry,
  onRemove,
  isRetrying,
  isRemoving,
}: {
  item: WishlistItem;
  isSelected: boolean;
  onToggle: () => void;
  onRetry: () => void;
  onRemove: () => void;
  isRetrying: boolean;
  isRemoving: boolean;
}) {
  return (
    <tr>
      <td>
        <input type="checkbox" checked={isSelected} onChange={onToggle} />
      </td>
      <td
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={`${item.trackArtist} — ${item.trackTitle}`}
      >
        {item.trackTitle} <span className="text-muted">— {item.trackArtist}</span>
      </td>
      <td className="text-muted text-sm">{item.playlistName ?? "—"}</td>
      <td className="text-sm" style={{ textAlign: "center" }}>{item.wishlistRetries ?? 0}</td>
      <td className="text-muted text-sm">{formatRelative(item.nextRetryAt)}</td>
      <td
        className="text-sm"
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: item.error ? "var(--danger)" : undefined }}
        title={item.error ?? ""}
      >
        {item.error ?? ""}
      </td>
      <td>
        <div className="flex gap-1">
          <button
            onClick={onRetry}
            disabled={isRetrying}
            title="Force retry search now"
          >
            Retry
          </button>
          <button
            className="danger"
            onClick={onRemove}
            disabled={isRemoving}
            title="Remove from wishlist"
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}

export function Wishlist() {
  const { data: wishlist, isLoading } = useWishlist();
  const retryItem = useRetryWishlistItem();
  const removeItem = useRemoveFromWishlist();
  const wishlistRun = useWishlistRun();
  const selection = useMultiSelect();
  const [search, setSearch] = useState("");
  const [bulkRemoving, setBulkRemoving] = useState(false);

  const filtered = useMemo(() => {
    if (!wishlist) return [];
    if (!search) return wishlist;
    const q = search.toLowerCase();
    return wishlist.filter(
      (w) =>
        w.trackTitle.toLowerCase().includes(q) ||
        w.trackArtist.toLowerCase().includes(q),
    );
  }, [wishlist, search]);

  const handleBulkRemove = async () => {
    setBulkRemoving(true);
    const ids = [...selection.selected];
    for (const id of ids) {
      try {
        await removeItem.mutateAsync(id);
      } catch {
        // continue with remaining
      }
    }
    selection.clear();
    setBulkRemoving(false);
  };

  if (isLoading) return <p className="text-muted">Loading wishlist...</p>;

  return (
    <>
      <div className="page-header">
        <h2>
          Wishlist
          {wishlist && wishlist.length > 0 && (
            <span className="badge badge-yellow" style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>
              {wishlist.length}
            </span>
          )}
        </h2>
        <div className="flex gap-1">
          <input
            type="text"
            placeholder="Search by title or artist..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          <button
            onClick={() => wishlistRun.mutate()}
            disabled={wishlistRun.isPending}
          >
            {wishlistRun.isPending
              ? "Running..."
              : wishlistRun.isSuccess
                ? `Queued (job ${wishlistRun.data.jobId.slice(0, 8)})`
                : "Run Wishlist"}
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 30 }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selection.count === filtered.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selection.count > 0 && selection.count < filtered.length;
                  }}
                  onChange={() => {
                    if (selection.count === filtered.length) {
                      selection.clear();
                    } else {
                      selection.selectAll(filtered.map((w) => w.id));
                    }
                  }}
                />
              </th>
              <th>Track</th>
              <th>Playlist</th>
              <th style={{ textAlign: "center" }}>Retries</th>
              <th>Next Retry</th>
              <th>Error / Reason</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <WishlistRow
                key={item.id}
                item={item}
                isSelected={selection.isSelected(item.id)}
                onToggle={() => selection.toggle(item.id)}
                onRetry={() => retryItem.mutate(item.id)}
                onRemove={() => removeItem.mutate(item.id)}
                isRetrying={retryItem.isPending}
                isRemoving={removeItem.isPending}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted">
                  {search ? "No wishlisted tracks match your search." : "No wishlisted tracks."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <BulkToolbar count={selection.count} onClear={selection.clear}>
        <button
          className="danger"
          onClick={handleBulkRemove}
          disabled={bulkRemoving}
        >
          {bulkRemoving ? "Removing..." : `Remove Selected (${selection.count})`}
        </button>
      </BulkToolbar>
    </>
  );
}
