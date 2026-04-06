export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string;
  snapshotId: string;
  trackCount: number;
  uri: string;
  ownerId: string;
  ownerName: string;
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  durationMs: number;
  isrc?: string;
  uri: string;
  isLocal?: boolean;
}
