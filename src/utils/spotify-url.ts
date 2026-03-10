/**
 * Extract a Spotify playlist ID from a URL or return the input as-is if it's already an ID.
 * Handles URLs like:
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123
 */
export function extractPlaylistId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);
    if (
      url.hostname === "open.spotify.com" &&
      url.pathname.startsWith("/playlist/")
    ) {
      const id = url.pathname.replace("/playlist/", "");
      return id || trimmed;
    }
  } catch {
    // Not a URL — treat as bare ID
  }

  return trimmed;
}
