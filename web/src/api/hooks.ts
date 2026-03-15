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
