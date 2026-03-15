export interface LexiconTrack {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  tags?: string[];
}

export interface LexiconPlaylist {
  id: string;
  name: string;
  trackIds: string[];
}

export interface LexiconTagCategory {
  id: string;
  label: string;
  color?: string;
}

export interface LexiconTag {
  id: string;
  categoryId: string;
  label: string;
}
