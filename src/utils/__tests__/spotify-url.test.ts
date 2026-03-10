import { describe, it, expect } from "vitest";
import { extractPlaylistId } from "../spotify-url.js";

describe("extractPlaylistId", () => {
  it("extracts ID from a full Spotify URL", () => {
    expect(
      extractPlaylistId(
        "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      ),
    ).toBe("37i9dQZF1DXcBWIGoYBM5M");
  });

  it("extracts ID from a URL with query params", () => {
    expect(
      extractPlaylistId(
        "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123",
      ),
    ).toBe("37i9dQZF1DXcBWIGoYBM5M");
  });

  it("returns a bare ID as-is", () => {
    expect(extractPlaylistId("37i9dQZF1DXcBWIGoYBM5M")).toBe(
      "37i9dQZF1DXcBWIGoYBM5M",
    );
  });

  it("returns empty string for empty input", () => {
    expect(extractPlaylistId("")).toBe("");
    expect(extractPlaylistId("   ")).toBe("");
  });

  it("trims whitespace from input", () => {
    expect(extractPlaylistId("  37i9dQZF1DXcBWIGoYBM5M  ")).toBe(
      "37i9dQZF1DXcBWIGoYBM5M",
    );
  });

  it("returns non-Spotify URLs as-is", () => {
    expect(extractPlaylistId("https://example.com/playlist/abc")).toBe(
      "https://example.com/playlist/abc",
    );
  });

  it("returns non-playlist Spotify URLs as-is", () => {
    expect(
      extractPlaylistId("https://open.spotify.com/track/abc123"),
    ).toBe("https://open.spotify.com/track/abc123");
  });
});
