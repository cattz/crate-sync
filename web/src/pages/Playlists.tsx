import { useState, useMemo } from "react";
import { Link } from "react-router";
import { usePlaylists, useRenamePlaylist, useDeletePlaylist, useSyncPlaylists, useCrossPlaylistDuplicates, useMergePlaylists } from "../api/hooks.js";
import type { Playlist } from "../api/client.js";
import { useMultiSelect } from "../hooks/useMultiSelect.js";
import { BulkToolbar } from "../components/BulkToolbar.js";

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
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
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

function BulkMergeModal({
  playlists,
  onClose,
}: {
  playlists: Playlist[];
  onClose: () => void;
}) {
  const merge = useMergePlaylists();
  const [targetId, setTargetId] = useState(playlists[0]?.id ?? "");

  const handleMerge = async () => {
    const sourceIds = playlists.filter((p) => p.id !== targetId).map((p) => p.id);
    if (sourceIds.length === 0) return;
    await merge.mutateAsync({ targetId, sourceIds });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400 }}>
        <h3 style={{ marginBottom: "0.5rem" }}>Merge {playlists.length} Playlists</h3>
        <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
          Choose a target playlist. Tracks from the other playlists will be merged into it. Duplicates are skipped.
        </p>
        <div style={{ maxHeight: 250, overflow: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", marginBottom: "0.5rem" }}>
          {playlists.map((p) => (
            <label
              key={p.id}
              className="flex items-center"
              style={{
                padding: "0.35rem 0.5rem",
                cursor: "pointer",
                background: targetId === p.id ? "var(--bg-hover)" : "transparent",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <input
                type="radio"
                name="merge-target"
                checked={targetId === p.id}
                onChange={() => setTargetId(p.id)}
                style={{ marginRight: "0.5rem" }}
              />
              <span>{p.name}</span>
              <span className="text-muted text-sm" style={{ marginLeft: "auto" }}>{p.trackCount} tracks</span>
            </label>
          ))}
        </div>
        <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={merge.isPending || playlists.length < 2}
            onClick={handleMerge}
          >
            {merge.isPending ? "Merging..." : `Merge into ${playlists.find((p) => p.id === targetId)?.name ?? "..."}`}
          </button>
        </div>
        {merge.isError && <p style={{ color: "var(--danger)", marginTop: "0.3rem" }}>{merge.error.message}</p>}
      </div>
    </div>
  );
}

export function Playlists() {
  const { data: playlists, isLoading } = usePlaylists();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [renaming, setRenaming] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState<Playlist | null>(null);
  const sync = useSyncPlaylists();
  const [showCrossDupes, setShowCrossDupes] = useState(false);
  const crossDupes = useCrossPlaylistDuplicates(showCrossDupes);
  const selection = useMultiSelect();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkMerging, setBulkMerging] = useState(false);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
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
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }

    return [...list].sort((a, b) => {
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
  }, [playlists, search, sortKey, sortDir, ownership]);

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
          <button onClick={() => setShowCrossDupes(!showCrossDupes)}>
            {showCrossDupes ? "Hide Dupes" : "Cross-Playlist Dupes"}
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
          <input
            type="text"
            placeholder="Search playlists…"
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

      {showCrossDupes && crossDupes.isLoading && (
        <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>Scanning for cross-playlist duplicates...</p>
      )}
      {showCrossDupes && crossDupes.data && crossDupes.data.length === 0 && (
        <div className="text-sm" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}>
          No cross-playlist duplicates found.
        </div>
      )}
      {showCrossDupes && crossDupes.data && crossDupes.data.length > 0 && (
        <div className="card mb-2">
          <h3 style={{ marginBottom: "0.3rem" }}>Cross-Playlist Duplicates ({crossDupes.data.length} tracks)</h3>
          <table>
            <thead>
              <tr>
                <th>Track</th>
                <th>Artist</th>
                <th>In Playlists</th>
              </tr>
            </thead>
            <tbody>
              {crossDupes.data.map((d) => (
                <tr key={d.track.id}>
                  <td>{d.track.title}</td>
                  <td className="text-muted">{d.track.artist}</td>
                  <td className="text-muted text-sm">
                    {d.playlists.map((p) => p.name).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
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
              <SortHeader label="Tracks" sortKey="trackCount" active={sortKey === "trackCount"} direction={sortDir} onSort={handleSort} />
              {ownership !== "own" && <SortHeader label="Owner" sortKey="ownerName" active={sortKey === "ownerName"} direction={sortDir} onSort={handleSort} />}
              <SortHeader label="Last Synced" sortKey="lastSynced" active={sortKey === "lastSynced"} direction={sortDir} onSort={handleSort} />
              <th></th>
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
                  <Link to={`/playlists/${p.id}`}>{p.name}</Link>
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
                  {search || ownership !== "all"
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

      <BulkToolbar count={selection.count} onClear={selection.clear}>
        <button
          className="danger"
          onClick={() => setBulkDeleting(true)}
        >
          Delete Selected
        </button>
        <button
          className="primary"
          onClick={() => setBulkMerging(true)}
          disabled={selection.count < 2}
        >
          Merge Selected
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
      {bulkMerging && (
        <BulkMergeModal
          playlists={(playlists ?? []).filter((p) => selection.selected.has(p.id))}
          onClose={() => {
            setBulkMerging(false);
            selection.clear();
          }}
        />
      )}
    </>
  );
}
