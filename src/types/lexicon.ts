export interface LexiconTrack {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

export interface LexiconPlaylist {
  id: string;
  name: string;
  trackIds: string[];
}
