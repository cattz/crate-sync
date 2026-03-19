import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";

export function usePlaylists() {
  return useQuery({ queryKey: ["playlists"], queryFn: api.getPlaylists });
}

export function usePlaylist(id: string) {
  return useQuery({ queryKey: ["playlist", id], queryFn: () => api.getPlaylist(id) });
}

export function usePlaylistTracks(id: string) {
  return useQuery({ queryKey: ["playlist-tracks", id], queryFn: () => api.getPlaylistTracks(id) });
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
