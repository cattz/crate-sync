import { useState, useMemo, useCallback } from "react";
import { Link, useSearchParams } from "react-router";
import { usePlaylists, useRenamePlaylist, useDeletePlaylist, useSyncPlaylists, useBulkRename, useBulkSync, useBulkUpdateTags, useMergePlaylists, useImportPlaylist } from "../api/hooks.js";
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
type SourceFilter = "all" | "spotify" | "file" | "local";

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

function ImportModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<"m3u" | "csv" | "txt">("txt");
  const importMut = useImportPlaylist();
  const [result, setResult] = useState<{ added: number; duplicates: number } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    const res = await importMut.mutateAsync({ name: name.trim(), content, format });
    setResult({ added: res.added, duplicates: res.duplicates });
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!name.trim()) {
      setName(file.name.replace(/\.[^.]+$/, ""));
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "m3u" || ext === "m3u8") setFormat("m3u");
    else if (ext === "csv") setFormat("csv");
    else setFormat("txt");
    file.text().then(setContent);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <h3 style={{ marginBottom: "0.5rem" }}>Import Playlist</h3>
        {result ? (
          <>
            <p style={{ marginBottom: "0.5rem", color: "var(--accent)" }}>
              Imported {result.added} track(s){result.duplicates > 0 ? `, ${result.duplicates} duplicate(s) skipped` : ""}.
            </p>
            <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
              <button className="primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="text-sm text-muted" style={{ display: "block", marginBottom: "0.25rem" }}>Playlist name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Playlist"
              style={{ width: "100%", marginBottom: "0.5rem" }}
              autoFocus
            />
            <label className="text-sm text-muted" style={{ display: "block", marginBottom: "0.25rem" }}>Format</label>
            <div className="flex gap-1" style={{ marginBottom: "0.5rem" }}>
              {(["txt", "csv", "m3u"] as const).map((f) => (
                <button key={f} type="button" className={format === f ? "primary" : ""} onClick={() => setFormat(f)} style={{ textTransform: "uppercase", fontSize: "0.8rem" }}>
                  {f}
                </button>
              ))}
            </div>
            <label className="text-sm text-muted" style={{ display: "block", marginBottom: "0.25rem" }}>
              {format === "txt" ? "One track per line: Artist - Title" : format === "csv" ? "CSV with artist, title columns" : "M3U/M3U8 content"}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder={format === "txt" ? "Artist One - Song One\nArtist Two - Song Two" : format === "csv" ? "artist,title,album\nArtist,Song,Album" : "#EXTM3U\n#EXTINF:240,Artist - Song\nfile.mp3"}
              style={{ width: "100%", marginBottom: "0.5rem", fontFamily: "monospace", fontSize: "0.8rem" }}
            />
            <div className="flex items-center gap-1" style={{ marginBottom: "0.5rem" }}>
              <label className="text-sm text-muted">Or load from file:</label>
              <input type="file" accept=".txt,.csv,.m3u,.m3u8" onChange={handleFile} style={{ fontSize: "0.8rem" }} />
            </div>
            <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit" className="primary" disabled={importMut.isPending || !name.trim() || !content.trim()}>
                {importMut.isPending ? "Importing..." : "Import"}
              </button>
            </div>
            {importMut.isError && <p style={{ color: "var(--danger)", marginTop: "0.3rem" }}>{importMut.error.message}</p>}
          </form>
        )}
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

function BulkTagEditor({
  selectedPlaylists,
  onClose,
}: {
  selectedPlaylists: Playlist[];
  onClose: () => void;
}) {
  const [newTag, setNewTag] = useState("");
  const bulkTags = useBulkUpdateTags();

  const tagInfo = useMemo(() => {
    const tagCounts = new Map<string, number>();
    for (const p of selectedPlaylists) {
      for (const t of parseTags(p.tags)) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const total = selectedPlaylists.length;
    return [...tagCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, count]) => ({
        tag,
        count,
        isCommon: count === total,
      }));
  }, [selectedPlaylists]);

  const playlistIds = selectedPlaylists.map((p) => p.id);

  const handleTagClick = (tag: string, isCommon: boolean) => {
    if (isCommon) {
      bulkTags.mutate({ playlistIds, addTags: [], removeTags: [tag] });
    } else {
      bulkTags.mutate({ playlistIds, addTags: [tag], removeTags: [] });
    }
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newTag.trim().toLowerCase();
    if (!tag) return;
    bulkTags.mutate({ playlistIds, addTags: [tag], removeTags: [] });
    setNewTag("");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400 }}>
        <h3 style={{ marginBottom: "0.5rem" }}>
          Editing tags for {selectedPlaylists.length} playlists
        </h3>

        <div style={{ marginBottom: "0.75rem" }}>
          {tagInfo.length === 0 && (
            <p className="text-muted text-sm">No tags on selected playlists.</p>
          )}
          <div className="flex gap-1" style={{ flexWrap: "wrap" }}>
            {tagInfo.map(({ tag, count, isCommon }) => (
              <span
                key={tag}
                className={isCommon ? "badge badge-green" : "badge"}
                style={{
                  cursor: "pointer",
                  ...(isCommon
                    ? {}
                    : { opacity: 0.5, border: "1px dashed var(--text-muted)" }),
                }}
                title={
                  isCommon
                    ? `Present in all ${selectedPlaylists.length} playlists. Click to remove from all.`
                    : `Present in ${count}/${selectedPlaylists.length} playlists. Click to add to all.`
                }
                onClick={() => handleTagClick(tag, isCommon)}
              >
                {tag}
                {!isCommon && (
                  <span style={{ marginLeft: "0.25rem", fontSize: "0.7rem" }}>
                    {count}/{selectedPlaylists.length}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>

        <form onSubmit={handleAddTag} className="flex gap-1" style={{ marginBottom: "0.75rem" }}>
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Add new tag..."
            style={{ flex: 1 }}
            autoFocus
          />
          <button type="submit" className="primary" disabled={!newTag.trim() || bulkTags.isPending}>
            Add
          </button>
        </form>

        {bulkTags.isError && (
          <p style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>{bulkTags.error.message}</p>
        )}

        <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="text-muted" style={{ fontSize: "0.7rem", marginTop: "0.5rem" }}>Changes apply immediately.</p>
      </div>
    </div>
  );
}

function MergeModal({
  selectedPlaylists,
  allPlaylists,
  onClose,
}: {
  selectedPlaylists: Playlist[];
  allPlaylists: Playlist[];
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState<string>("new");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [deleteSources, setDeleteSources] = useState(false);
  const merge = useMergePlaylists();
  const [result, setResult] = useState<{ added: number; duplicates: number } | null>(null);

  const selectedIds = new Set(selectedPlaylists.map((p) => p.id));

  // Target options: all playlists NOT in the selection, plus "new"
  const targetOptions = allPlaylists.filter((p) => !selectedIds.has(p.id));

  const canMerge = targetId === "new" ? newPlaylistName.trim().length > 0 : true;

  const handleMerge = async () => {
    const sourceIds = selectedPlaylists.map((p) => p.id);
    const data = await merge.mutateAsync({
      targetId,
      targetName: targetId === "new" ? newPlaylistName.trim() : undefined,
      sourceIds,
      deleteSources,
    });
    setResult({ added: data.added, duplicates: data.duplicates });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400 }}>
        <h3 style={{ marginBottom: "0.75rem" }}>Merge {selectedPlaylists.length} playlists</h3>

        <div style={{ marginBottom: "0.75rem" }}>
          <label className="text-sm text-muted" style={{ display: "block", marginBottom: "0.25rem" }}>Target playlist</label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            style={{ width: "100%", marginBottom: "0.5rem" }}
          >
            <option value="new">Create new playlist</option>
            {targetOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {targetId === "new" && (
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist name..."
              style={{ width: "100%", marginBottom: "0.5rem" }}
              autoFocus
            />
          )}
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={deleteSources}
              onChange={(e) => setDeleteSources(e.target.checked)}
            />
            <span className="text-sm">Delete source playlists after merge</span>
          </label>
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label className="text-sm text-muted" style={{ display: "block", marginBottom: "0.25rem" }}>Source playlists</label>
          <ul style={{ paddingLeft: "1.25rem", maxHeight: 150, overflow: "auto", margin: 0 }}>
            {selectedPlaylists.map((p) => (
              <li key={p.id} className="text-sm">{p.name} ({p.trackCount} tracks)</li>
            ))}
          </ul>
        </div>

        {result && (
          <p className="text-sm" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}>
            Added {result.added} tracks, {result.duplicates} duplicates skipped
          </p>
        )}

        {merge.isError && (
          <p style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>{merge.error.message}</p>
        )}

        <div className="flex gap-1" style={{ justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          {!result && (
            <button
              className="primary"
              onClick={handleMerge}
              disabled={!canMerge || merge.isPending}
            >
              {merge.isPending ? "Merging..." : "Merge"}
            </button>
          )}
        </div>
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
  const sourceFilter = (params.get("source") ?? "all") as SourceFilter;
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
  const setSourceFilter = useCallback((v: SourceFilter) => setParam("source", v, "all"), [setParam]);
  const setTagFilter = useCallback((v: string) => setParam("tag", v, ""), [setParam]);

  const [renaming, setRenaming] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState<Playlist | null>(null);
  const sync = useSyncPlaylists();
  const selection = useMultiSelect();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkRename, setShowBulkRename] = useState(false);
  const [showBulkTags, setShowBulkTags] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const bulkSync = useBulkSync();
  const [bulkSyncResult, setBulkSyncResult] = useState<string | null>(null);

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

    if (sourceFilter !== "all") {
      list = list.filter((p) => (p.source ?? "spotify") === sourceFilter);
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
  }, [playlists, search, sortKey, sortDir, ownership, sourceFilter, tagFilter]);

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
          <button onClick={() => setShowImport(true)}>Import</button>
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
          <span style={{ borderLeft: "1px solid var(--border)", height: 20, margin: "0 0.15rem" }} />
          {(["all", "spotify", "file", "local"] as const).map((value) => (
            <button
              key={value}
              className={sourceFilter === value ? "primary" : ""}
              onClick={() => setSourceFilter(value)}
              style={{ textTransform: "capitalize", fontSize: "0.8rem" }}
            >
              {value === "all" ? "All Sources" : value === "spotify" ? "Spotify" : value === "file" ? "File" : "Local"}
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
      {bulkSyncResult && (
        <div className="text-sm" style={{ color: "var(--accent)", marginBottom: "0.5rem" }}>
          {bulkSyncResult}
        </div>
      )}
      {bulkSync.isError && (
        <div className="text-sm" style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>
          {bulkSync.error.message}
        </div>
      )}

      <div className="card">
        <table style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 30 }} />
            <col />
            <col style={{ width: 60 }} />
            <col style={{ width: 60 }} />
            {ownership !== "own" && <col style={{ width: 100 }} />}
            <col style={{ width: 110 }} />
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
                      selection.selectAll(filtered.map((p) => p.id));
                    }
                  }}
                />
              </th>
              <SortHeader label="Name" sortKey="name" active={sortKey === "name"} direction={sortDir} onSort={handleSort} />
              <SortHeader label="Tracks" sortKey="trackCount" active={sortKey === "trackCount"} direction={sortDir} onSort={handleSort} />
              <th className="text-muted text-sm">Source</th>
              {ownership !== "own" && <SortHeader label="Owner" sortKey="ownerName" active={sortKey === "ownerName"} direction={sortDir} onSort={handleSort} />}
              <SortHeader label="Last Synced" sortKey="lastSynced" active={sortKey === "lastSynced"} direction={sortDir} onSort={handleSort} />
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
                <td style={{ overflow: "hidden" }}>
                  <div className="flex items-center gap-1" style={{ flexWrap: "nowrap", overflow: "hidden" }}>
                    {p.pinned ? <span className="badge badge-green" title="Pinned" style={{ flexShrink: 0 }}>pinned</span> : null}
                    <Link to={`/playlists/${p.id}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>{p.name}</Link>
                    {parseTags(p.tags).slice(0, 3).map((tag) => (
                      <span key={tag} className="badge badge-blue" style={{ flexShrink: 0, fontSize: "0.7rem" }}>{tag}</span>
                    ))}
                  </div>
                </td>
                <td>
                  {p.trackCount}
                  {(p.brokenTracks ?? 0) > 0 && (
                    <span className="badge badge-red" style={{ marginLeft: "0.3rem", fontSize: "0.65rem" }} title={`${p.brokenTracks} broken/local tracks`}>
                      {p.brokenTracks}
                    </span>
                  )}
                </td>
                <td className="text-muted text-sm">{p.source ?? "spotify"}</td>
                {ownership !== "own" && (
                  <td className="text-muted text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={p.isOwned === 1 ? "You" : (p.ownerName ?? "")}>
                    {p.isOwned === 1 ? "You" : (p.ownerName ?? "—")}
                  </td>
                )}
                <td className="text-muted text-sm">{formatDate(p.lastSynced)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={ownership === "own" ? 5 : 6} className="text-muted">
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
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
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
        <button
          className="primary"
          onClick={() => {
            const ids = [...selection.selected];
            if (ids.length === 0) return;
            bulkSync.mutate(ids, {
              onSuccess: (data) => {
                selection.clear();
                setBulkSyncResult(`Queued ${data.queued} playlist(s) for matching & tagging`);
              },
            });
          }}
          disabled={bulkSync.isPending}
        >
          {bulkSync.isPending ? "Syncing..." : `Match & Tag (${selection.count})`}
        </button>
        <button onClick={() => setShowBulkTags(true)}>
          Edit Tags
        </button>
        <button onClick={() => setShowMerge(true)}>
          Merge
        </button>
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

      {showBulkTags && (
        <BulkTagEditor
          selectedPlaylists={(playlists ?? []).filter((p) => selection.selected.has(p.id))}
          onClose={() => setShowBulkTags(false)}
        />
      )}

      {bulkDeleting && (
        <BulkDeleteModal
          playlists={(playlists ?? []).filter((p) => selection.selected.has(p.id))}
          onClose={() => {
            setBulkDeleting(false);
            selection.clear();
          }}
        />
      )}

      {showMerge && (
        <MergeModal
          selectedPlaylists={(playlists ?? []).filter((p) => selection.selected.has(p.id))}
          allPlaylists={playlists ?? []}
          onClose={() => {
            setShowMerge(false);
            selection.clear();
          }}
        />
      )}
    </>
  );
}
