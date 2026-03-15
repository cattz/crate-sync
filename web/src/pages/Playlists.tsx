import { Link } from "react-router";
import { usePlaylists } from "../api/hooks.js";

function formatDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Playlists() {
  const { data: playlists, isLoading } = usePlaylists();

  if (isLoading) return <p className="text-muted">Loading playlists...</p>;

  return (
    <>
      <h2>Playlists</h2>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Tracks</th>
              <th>Last Synced</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {playlists?.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/playlists/${p.id}`}>{p.name}</Link>
                </td>
                <td>{p.trackCount}</td>
                <td className="text-muted text-sm">{formatDate(p.lastSynced)}</td>
                <td>
                  <Link to={`/playlists/${p.id}`}>
                    <button>View</button>
                  </Link>
                </td>
              </tr>
            ))}
            {playlists?.length === 0 && (
              <tr>
                <td colSpan={4} className="text-muted">
                  No playlists. Run <code>crate-sync db sync</code> to import from Spotify.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
