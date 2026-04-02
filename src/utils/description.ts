/**
 * Spotify description ↔ notes+tags helpers.
 *
 * Extracted from SpotifyService to avoid circular imports
 * (PlaylistService needs these but shouldn't depend on SpotifyService).
 */

/**
 * Compose a Spotify description from local notes and tags.
 * Format: notes first, then "\n\nTags: tag1, tag2, tag3"
 */
export function composeDescription(notes: string | null, tags: string | null): string {
  const parts: string[] = [];

  if (notes && notes.trim()) {
    parts.push(notes.trim());
  }

  let parsedTags: string[] = [];
  if (tags) {
    try { parsedTags = JSON.parse(tags); } catch { /* ignore */ }
  }

  if (parsedTags.length > 0) {
    parts.push(`Tags: ${parsedTags.join(", ")}`);
  }

  return parts.join("\n\n");
}

/**
 * Parse a Spotify description into notes and tags.
 * Looks for a "Tags: ..." line at the end.
 */
export function parseDescription(description: string | undefined | null): {
  notes: string;
  tags: string[];
} {
  if (!description || !description.trim()) {
    return { notes: "", tags: [] };
  }

  const text = description.trim();

  // Look for "Tags: ..." at the end (after last double-newline)
  const tagLineRe = /\n\n\s*Tags:\s*(.+)$/i;
  const match = text.match(tagLineRe);

  if (match) {
    const notes = text.slice(0, match.index!).trim();
    const tags = match[1].split(",").map((t) => t.trim()).filter(Boolean);
    return { notes, tags };
  }

  return { notes: text, tags: [] };
}
