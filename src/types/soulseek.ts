export interface SlskdFile {
  filename: string;
  size: number;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  length?: number;
  username: string;
  code: string;
}

export interface SlskdSearchResult {
  id: string;
  searchText: string;
  state: string;
  fileCount: number;
  files: SlskdFile[];
}

export interface SlskdTransfer {
  id: string;
  username: string;
  filename: string;
  state: string;
  bytesTransferred: number;
  size: number;
  percentComplete: number;
}
