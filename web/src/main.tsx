import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Playlists } from "./pages/Playlists.js";
import { PlaylistDetail } from "./pages/PlaylistDetail.js";
import { Matches } from "./pages/Matches.js";
import { Downloads } from "./pages/Downloads.js";
import { Queue } from "./pages/Queue.js";
import { JobDetail } from "./pages/JobDetail.js";
import { Review } from "./pages/Review.js";
import { TrackDetail } from "./pages/TrackDetail.js";
import { Logs } from "./pages/Logs.js";
import { Settings } from "./pages/Settings.js";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route index element={<Dashboard />} />
            <Route path="playlists" element={<Playlists />} />
            <Route path="playlists/:id" element={<PlaylistDetail />} />
            <Route path="matches" element={<Matches />} />
            <Route path="downloads" element={<Downloads />} />
            <Route path="queue" element={<Queue />} />
            <Route path="queue/:id" element={<JobDetail />} />
            <Route path="logs" element={<Logs />} />
            <Route path="review" element={<Review />} />
            <Route path="tracks/:id" element={<TrackDetail />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
