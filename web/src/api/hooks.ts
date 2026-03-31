import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type BulkRenameParams, type PlaylistMeta } from "./client.js";

export function usePlaylists() {
  return useQuery({ queryKey: ["playlists"], queryFn: api.getPlaylists });
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

export function usePushPlaylist() {
  return useMutation({
    mutationFn: (id: string) => api.pushPlaylist(id),
  });
}

export function usePullPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.pullPlaylist(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["playlist-tracks", id] });
      qc.invalidateQueries({ queryKey: ["playlist", id] });
    },
  });
}

export function usePlaylistTracks(id: string) {
  return useQuery({ queryKey: ["playlist-tracks", id], queryFn: () => api.getPlaylistTracks(id) });
}

// Review hooks

export function useReviewPending() {
  return useQuery({ queryKey: ["review-pending"], queryFn: api.getReviewPending });
}

export function useReviewStats() {
  return useQuery({
    queryKey: ["review-stats"],
    queryFn: api.getReviewStats,
    refetchInterval: 10000,
  });
}

export function useConfirmReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.confirmReview(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-pending"] });
      qc.invalidateQueries({ queryKey: ["review-stats"] });
      qc.invalidateQueries({ queryKey: ["matches"] });
    },
  });
}

export function useRejectReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rejectReview(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-pending"] });
      qc.invalidateQueries({ queryKey: ["review-stats"] });
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["downloads"] });
    },
  });
}

export function useBulkConfirmReviews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.bulkConfirmReviews(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-pending"] });
      qc.invalidateQueries({ queryKey: ["review-stats"] });
      qc.invalidateQueries({ queryKey: ["matches"] });
    },
  });
}

export function useBulkRejectReviews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.bulkRejectReviews(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-pending"] });
      qc.invalidateQueries({ queryKey: ["review-stats"] });
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["downloads"] });
    },
  });
}

// Match hooks

export function useMatches(status?: string) {
  return useQuery({ queryKey: ["matches", status], queryFn: () => api.getMatches(status) });
}

// Download hooks

export function useDownloads(status?: string) {
  return useQuery({
    queryKey: ["downloads", status],
    queryFn: () => api.getDownloads(status),
    refetchInterval: 5000,
  });
}

export function useClearDownloads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: "done" | "failed") => api.clearDownloads(status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["downloads"] });
    },
  });
}

// Wishlist

export function useWishlistRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.runWishlist,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-stats"] });
    },
  });
}

// Status hooks

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

// Sync hooks

export function useSyncTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trackId: string) => api.syncTrack(trackId),
    onSuccess: (_data, trackId) => {
      qc.invalidateQueries({ queryKey: ["track-lifecycle", trackId] });
      qc.invalidateQueries({ queryKey: ["matches"] });
    },
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

export function useTrackRejections(id: string) {
  return useQuery({
    queryKey: ["track-rejections", id],
    queryFn: () => api.getTrackRejections(id),
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
