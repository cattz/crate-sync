/** Small Spotify play button that opens a track or playlist in Spotify. */
export function SpotifyPlayButton({ type, spotifyId, size = 16 }: {
  type: "track" | "playlist";
  spotifyId: string | null | undefined;
  size?: number;
}) {
  if (!spotifyId) return null;

  const url = `https://open.spotify.com/${type}/${spotifyId}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Play on Spotify`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 4,
        height: size + 4,
        borderRadius: "50%",
        background: "#1db954",
        color: "#000",
        textDecoration: "none",
        fontSize: size * 0.7,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      &#9654;
    </a>
  );
}
