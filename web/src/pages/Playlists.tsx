import { useState, useMemo, useCallback } from "react";
import { Link, useSearchParams } from "react-router";
import { usePlaylists, useRenamePlaylist, useDeletePlaylist, useSyncPlaylists, useBulkRename } from "../api/hooks.js";
import type { Playlist, BulkRenamePreview } from "../api/client.js";
import { useMultiSelect } from "../hooks/useMultiSelect.js";
import { BulkToolbar } from "../components/BulkToolbar.js";

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try { return JSON.parse(tags); } catch { return []; }
}

type SortKey = "name" | "trackCount" | "ownerName" | "lastSynced";
type SortDir = "asc" | "desc";
type OwnershipFilter = "all" | "own" | "followed";

function formatDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SortHeader({
  label,
  sortKey,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  return (
    <th
      className={className}
      onClick={() => onSort(sortKey)}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      {label} {active ? (direction === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}

function RenameModal({
  playlist,
  onClose,
}: {
  playlist: Playlist;
  onClose: () => void;
}) {
  const [name, setName] = useState(playlist.name);
  const rename = useRenamePlaylist();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === playlist.name) return;
    await rename.mutateAsync({ id: playlist.id, name: name.trim() });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: "0.5rem" }}>Rename Playlist</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: "100%", marginBottom: "0.5rem" }}
            autoFocus
          />
          <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={rename.isPending || !name.trim() || name.trim() === playlist.name}>
              {rename.isPending ? "Renaming..." : "Rename"}
            </button>
          </div>
          {rename.isError && <p style={{ color: "var(--danger)", marginTop: "0.3rem" }}>{rename.error.message}</p>}
        </form>
      </div>
    </div>
  );
}

function DeleteModal({
  playlist,
  onClose,
}: {
  playlist: Playlist;
  onClose: () => void;
}) {
  const del = useDeletePlaylist();

  const handleDelete = async () => {
    await del.mutateAsync(playlist.id);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: "0.5rem" }}>Delete Playlist</h3>
        <p style={{ marginBottom: "0.5rem" }}>
          Delete <strong>{playlist.name}</strong> ({playlist.trackCount} tracks) from the local database?
        </p>
        <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
          This does not delete the playlist from Spotify.
        </p>
        <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          <button className="danger" onClick={handleDelete} disabled={del.isPending}>
            {del.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
        {del.isError && <p style={{ color: "var(--danger)", marginTop: "0.3rem" }}>{del.error.message}</p>}
      </div>
    </div>
  );
}

function BulkDeleteModal({
  playlists,
  onClose,
}: {
  playlists: Playlist[];
  onClose: () => void;
}) {
  const del = useDeletePlaylist();
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  const handleDelete = async () => {
    setRunning(true);
    for (let i = 0; i < playlists.length; i++) {
      await del.mutateAsync(playlists[i].id);
      setProgress(i + 1);
    }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: "0.5rem" }}>Delete {playlists.length} Playlists</h3>
        <p style={{ marginBottom: "0.5rem" }}>
          Delete the following playlists from the local database?
        </p>
        <ul style={{ marginBottom: "0.5rem", paddingLeft: "1.25rem", maxHeight: 200, overflow: "auto" }}>
          {playlists.map((p) => (
            <li key={p.id} className="text-sm">{p.name} ({p.trackCount} tracks)</li>
          ))}
        </ul>
        <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
          This does not delete playlists from Spotify.
        </p>
        {running && (
          <p className="text-sm" style={{ marginBottom: "0.5rem" }}>
            Deleting... {progress}/{playlists.length}
          </p>
        )}
        <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={running}>Cancel</button>
          <button className="danger" onClick={handleDelete} disabled={running}>
            {running ? `Deleting ${progress}/${playlists.length}...` : `Delete ${playlists.length} Playlists`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkRenameModal({ playlistIds, onClose }: { playlistIds?: string[]; onClose: () => void }) {
  const [pattern, setPattern] = useState("");
  const [replacement, setReplacement] = useState("");
  const [preview, setPreview] = useState<BulkRenamePreview[] | null>(null);
  const bulkRename = useBulkRename();

  const canPreview = pattern.length > 0;

  const handlePreview = async () => {
    setPreview(null);
    const result = await bulkRename.mutateAsync({ pattern, replacement, dryRun: true, playlistIds });
    setPreview(result);
  };

  const handleApply = async () => {
    await bulkRename.mutateAsync({ pattern, replacement, dryRun: false, playlistIds });
    onClose();
  };

  const resetPreview = () => setPreview(null);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 480 }}>
        <h3 style={{ marginBottom: "0.75rem" }}>Bulk Rename Playlists</h3>

        <div style={{ marginBottom: "0.75rem" }}>
          <label className="text-sm text-muted" style={{ display: "block", marginBottom: "0.25rem" }}>Pattern (regex)</label>
          <input
            type="text"
            value={pattern}
            onChange={(e) => { setPattern(e.target.value); resetPreview(); }}
            placeholder="Regex pattern to match..."
            style={{ width: "100%", marginBottom: "0.5rem" }}
            autoFocus
          />
          <label className="text-sm text-muted" style={{ display: "block", marginBottom: "0.25rem" }}>Replacement</label>
          <input
            type="text"
            value={replacement}
            onChange={(e) => { setReplacement(e.target.value); resetPreview(); }}
            placeholder="Replacement text (leave empty to delete)"
            style={{ width: "100%" }}
          />
        </div>

        {/* Preview table */}
        {preview !== null && preview.length === 0 && (
          <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
            No playlists would be affected.
          </p>
        )}

        {preview !== null && preview.length > 0 && (
          <div style={{ marginBottom: "0.75rem", maxHeight: 300, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Current Name</th>
                  <th>New Name</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.id}>
                    <td className="text-muted">{p.name}</td>
                    <td>{p.newName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
              {preview.length} playlist{preview.length !== 1 ? "s" : ""} will be renamed.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            onClick={handlePreview}
            disabled={!canPreview || bulkRename.isPending}
          >
            {bulkRename.isPending && !preview ? "Loading..." : "Preview"}
          </button>
          {preview !== null && preview.length > 0 && (
            <button
              className="primary"
              onClick={handleApply}
              disabled={bulkRename.isPending}
            >
              {bulkRename.isPending ? "Applying..." : "Apply"}
            </button>
          )}
        </div>

        {bulkRename.isError && (
          <p style={{ color: "var(--danger)", marginTop: "0.3rem" }}>{bulkRename.error.message}</p>
        )}
      </div>
    </div>
  );
}

export function Playlists() {
  const { data: playlists, isLoading } = usePlaylists();
  const [params, setParams] = useSearchParams();

  // Persist filter/sort state in URL search params
  const search = params.get("q") ?? "";
  const sortKey = (params.get("sort") ?? "name") as SortKey;
  const sortDir = (params.get("dir") ?? "asc") as SortDir;
  const ownership = (params.get("owner") ?? "own") as OwnershipFilter;
  const tagFilter = params.get("tag") ?? "";

  const setParam = useCallback((key: string, value: string, fallback: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === fallback) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  }, [setParams]);

  const setSearch = useCallback((v: string) => setParam("q", v, ""), [setParam]);
  const setOwnership = useCallback((v: OwnershipFilter) => setParam("owner", v, "own"), [setParam]);
  const setTagFilter = useCallback((v: string) => setParam("tag", v, ""), [setParam]);

  const [renaming, setRenaming] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState<Playlist | null>(null);
  const sync = useSyncPlaylists();
  const selection = useMultiSelect();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkRename, setShowBulkRename] = useState(false);

  // Collect all unique tags across playlists for autocomplete/filter
  const allTags = useMemo(() => {
    if (!playlists) return [];
    const tagSet = new Set<string>();
    for (const p of playlists) {
      for (const t of parseTags(p.tags)) tagSet.add(t);
    }
    return [...tagSet].sort();
  }, [playlists]);

  function handleSort(key: SortKey) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key === sortKey) {
        const newDir = sortDir === "asc" ? "desc" : "asc";
        if (newDir === "asc") next.delete("dir"); else next.set("dir", newDir);
      } else {
        if (key === "name") next.delete("sort"); else next.set("sort", key);
        next.delete("dir");
      }
      return next;
    }, { replace: true });
  }

  const filtered = useMemo(() => {
    if (!playlists) return [];
    let list = playlists;

    if (ownership === "own") {
      list = list.filter((p) => p.isOwned === 1);
    } else if (ownership === "followed") {
      list = list.filter((p) => p.isOwned === 0);
    }

    if (search) {
      // Detect regex pattern: /pattern/ or /pattern/flags
      const regexMatch = search.match(/^\/(.+)\/([gimsuy]*)$/);
      if (regexMatch) {
        try {
          const re = new RegExp(regexMatch[1], regexMatch[2]);
          list = list.filter((p) => re.test(p.name));
        } catch {
          // Invalid regex — fall back to literal substring match
          const q = search.toLowerCase();
          list = list.filter((p) => p.name.toLowerCase().includes(q));
        }
      } else {
        const q = search.toLowerCase();
        list = list.filter((p) => p.name.toLowerCase().includes(q));
      }
    }

    if (tagFilter) {
      const tf = tagFilter.toLowerCase();
      list = list.filter((p) => parseTags(p.tags).some((t) => t.toLowerCase() === tf));
    }

    return [...list].sort((a, b) => {
      // Pinned playlists always sort to top
      const aPinned = a.pinned ? 1 : 0;
      const bPinned = b.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === "trackCount") {
        cmp = a.trackCount - b.trackCount;
      } else if (sortKey === "ownerName") {
        cmp = (a.ownerName ?? "").localeCompare(b.ownerName ?? "");
      } else {
        cmp = (a.lastSynced ?? 0) - (b.lastSynced ?? 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [playlists, search, sortKey, sortDir, ownership, tagFilter]);

  if (isLoading) return <p className="text-muted">Loading playlists...</p>;

  return (
    <>
      <div className="page-header">
        <h2>Playlists</h2>
        <div className="flex items-center gap-1">
          <button
            className="primary"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? "Syncing..." : "Sync from Spotify"}
          </button>
          {(["all", "own", "followed"] as const).map((value) => (
            <button
              key={value}
              className={ownership === value ? "primary" : ""}
              onClick={() => setOwnership(value)}
              style={{ textTransform: "capitalize" }}
            >
              {value === "own" ? "Own" : value === "followed" ? "Followed" : "All"}
            </button>
          ))}
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              style={{ marginLeft: "0.25rem" }}
            >
              <option value="">All Tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          <input
            type="text"
            placeholder="Search (/regex/ supported)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, marginLeft: "0.25rem" }}
          />
        </div>
      </div>
      {sync.isSuccess && (
        <div className="text-sm" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}>
          Synced: {sync.data.added} added, {sync.data.updated} updated, {sync.data.unchanged} unchanged
        </div>
      )}
      {sync.isError && (
        <div className="text-sm" style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>
          {sync.error.message}
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th className="col-check">
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
                      selection.selectAll(filtered.map((p) => p.id));
                    }
                  }}
                />
              </th>
              <SortHeader label="Name" sortKey="name" active={sortKey === "name"} direction={sortDir} onSort={handleSort} />
              <SortHeader label="Tracks" sortKey="trackCount" active={sortKey === "trackCount"} direction={sortDir} onSort={handleSort} className="col-sm" />
              {ownership !== "own" && <SortHeader label="Owner" sortKey="ownerName" active={sortKey === "ownerName"} direction={sortDir} onSort={handleSort} className="col-md" />}
              <SortHeader label="Last Synced" sortKey="lastSynced" active={sortKey === "lastSynced"} direction={sortDir} onSort={handleSort} className="col-md" />
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selection.isSelected(p.id)}
                    onChange={() => selection.toggle(p.id)}
                  />
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    {p.pinned ? <span className="badge badge-green" title="Pinned">pinned</span> : null}
                    <Link to={`/playlists/${p.id}`}>{p.name}</Link>
                    {parseTags(p.tags).map((tag) => (
                      <span key={tag} className="badge badge-blue">{tag}</span>
                    ))}
                  </div>
                </td>
                <td>{p.trackCount}</td>
                {ownership !== "own" && (
                  <td className="text-muted text-sm">
                    {p.isOwned === 1 ? "You" : (p.ownerName ?? "—")}
                  </td>
                )}
                <td className="text-muted text-sm">{formatDate(p.lastSynced)}</td>
                <td>
                  <div className="flex gap-1">
                    <Link to={`/playlists/${p.id}`}>
                      <button>View</button>
                    </Link>
                    <button onClick={() => setRenaming(p)} disabled={p.isOwned === 0}>Rename</button>
                    <button className="danger" onClick={() => setDeleting(p)} disabled={p.isOwned === 0}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={ownership === "own" ? 6 : 7} className="text-muted">
                  {search || ownership !== "own"
                    ? "No playlists match your filters."
                    : <>No playlists. Run <code>crate-sync db sync</code> to import from Spotify.</>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {renaming && <RenameModal playlist={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteModal playlist={deleting} onClose={() => setDeleting(null)} />}
      {showBulkRename && (
        <BulkRenameModal
          playlistIds={[...selection.selected]}
          onClose={() => {
            setShowBulkRename(false);
            selection.clear();
          }}
        />
      )}

      <BulkToolbar count={selection.count} onClear={selection.clear}>
        <button onClick={() => setShowBulkRename(true)}>
          Bulk Rename
        </button>
        <button
          className="danger"
          onClick={() => setBulkDeleting(true)}
        >
          Delete Selected
        </button>
      </BulkToolbar>

      {bulkDeleting && (
        <BulkDeleteModal
          playlists={(playlists ?? []).filter((p) => selection.selected.has(p.id))}
          onClose={() => {
            setBulkDeleting(false);
            selection.clear();
          }}
        />
      )}
    </>
  );
}
