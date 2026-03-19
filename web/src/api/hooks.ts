import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type BulkRenameParams, type PlaylistMeta } from "./client.js";

export function usePlaylists() {
  return useQuery({ queryKey: ["playlists"], queryFn: api.getPlaylists });
}

export function usePlaylistStats() {
  return useQuery({ queryKey: ["playlist-stats"], queryFn: api.getPlaylistStats });
}

export function usePlaylist(id: string) {
  return useQuery({ queryKey: ["playlist", id], queryFn: () => api.getPlaylist(id) });
}

export function useRenamePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renamePlaylist(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist"] });
    },
  });
}

export function useUpdatePlaylistMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: PlaylistMeta }) => api.updatePlaylistMeta(id, meta),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist"] });
    },
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlaylist(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
    },
  });
}

export function useBulkRename() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: BulkRenameParams) => api.bulkRename(params),
    onSuccess: (_data, variables) => {
      if (!variables.dryRun) {
        qc.invalidateQueries({ queryKey: ["playlists"] });
        qc.invalidateQueries({ queryKey: ["playlist"] });
      }
    },
  });
}

export function useSyncPlaylists() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.syncPlaylists,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

export function useMergePlaylists() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ targetId, sourceIds }: { targetId: string; sourceIds: string[] }) =>
      api.mergePlaylists(targetId, sourceIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist"] });
      qc.invalidateQueries({ queryKey: ["playlist-tracks"] });
    },
  });
}

export function usePushPlaylist() {
  return useMutation({
    mutationFn: (id: string) => api.pushPlaylist(id),
  });
}

export function useRepairPlaylist() {
  return useMutation({
    mutationFn: (id: string) => api.repairPlaylist(id),
  });
}

export function usePlaylistTracks(id: string) {
  return useQuery({ queryKey: ["playlist-tracks", id], queryFn: () => api.getPlaylistTracks(id) });
}

export function usePlaylistDuplicates(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["playlist-duplicates", id],
    queryFn: () => api.getPlaylistDuplicates(id),
    enabled,
  });
}

export function useCrossPlaylistDuplicates(enabled: boolean) {
  return useQuery({
    queryKey: ["cross-playlist-duplicates"],
    queryFn: api.getCrossPlaylistDuplicates,
    enabled,
  });
}

export function useSimilarPlaylists(threshold: number, enabled: boolean) {
  return useQuery({
    queryKey: ["similar-playlists", threshold],
    queryFn: () => api.getSimilarPlaylists(threshold),
    enabled,
  });
}

export function useMatches(status?: string) {
  return useQuery({ queryKey: ["matches", status], queryFn: () => api.getMatches(status) });
}

export function useUpdateMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "confirmed" | "rejected" }) =>
      api.updateMatch(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["matches"] }),
  });
}

export function useDownloads(status?: string) {
  return useQuery({
    queryKey: ["downloads", status],
    queryFn: () => api.getDownloads(status),
    refetchInterval: 5000,
  });
}

export function useStatus() {
  return useQuery({ queryKey: ["status"], queryFn: api.getStatus });
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: api.getConfig });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
  });
}

export function useStartSpotifyLogin() {
  return useMutation({
    mutationFn: api.startSpotifyLogin,
  });
}

export function useSpotifyAuthStatus(enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["spotify-auth-status"],
    queryFn: api.getSpotifyAuthStatus,
    enabled,
    refetchInterval: enabled ? 2000 : false,
    select: (data) => {
      if (data.authenticated) {
        qc.invalidateQueries({ queryKey: ["status"] });
      }
      return data;
    },
  });
}

export function useSpotifyLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.spotifyLogout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status"] }),
  });
}

export function useConnectSoulseek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { slskdUrl: string; slskdApiKey: string }) =>
      api.connectSoulseek(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status"] }),
  });
}

export function useDisconnectSoulseek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.disconnectSoulseek,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status"] }),
  });
}

export function useStartSync() {
  return useMutation({
    mutationFn: (playlistId: string) => api.startSync(playlistId),
  });
}

export function useDryRunSync() {
  return useMutation({
    mutationFn: (playlistId: string) => api.dryRunSync(playlistId),
  });
}

// Track lifecycle

export function useTrackLifecycle(id: string) {
  return useQuery({
    queryKey: ["track-lifecycle", id],
    queryFn: () => api.getTrackLifecycle(id),
    enabled: !!id,
  });
}

// Job hooks

export function useJobs(params?: { type?: string; status?: string; limit?: number }) {
  return useQuery({
    queryKey: ["jobs", params],
    queryFn: () => api.getJobs(params),
    refetchInterval: 3000,
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => api.getJob(id),
    refetchInterval: 3000,
  });
}

export function useJobStats() {
  return useQuery({
    queryKey: ["job-stats"],
    queryFn: api.getJobStats,
    refetchInterval: 5000,
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-stats"] });
    },
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-stats"] });
    },
  });
}

export function useRetryAllJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type?: string) => api.retryAllJobs(type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-stats"] });
    },
  });
}
