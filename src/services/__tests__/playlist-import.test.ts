import { describe, it, expect } from "vitest";
import { parseM3U, parseCSV, parseTXT, detectFormat } from "../playlist-import.js";

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------
describe("detectFormat", () => {
  it("detects m3u", () => expect(detectFormat("my-list.m3u")).toBe("m3u"));
  it("detects m3u8", () => expect(detectFormat("my-list.M3U8")).toBe("m3u"));
  it("detects csv", () => expect(detectFormat("tracks.csv")).toBe("csv"));
  it("detects txt", () => expect(detectFormat("playlist.txt")).toBe("txt"));
  it("returns null for unsupported", () => expect(detectFormat("data.json")).toBeNull());
});

// ---------------------------------------------------------------------------
// parseM3U
// ---------------------------------------------------------------------------
describe("parseM3U", () => {
  it("parses standard EXTINF lines", () => {
    const content = [
      "#EXTM3U",
      "#EXTINF:240,Artist One - Song One",
      "/path/to/file.flac",
      "#EXTINF:180,Artist Two - Song Two",
      "/path/to/file2.mp3",
    ].join("\n");

    const tracks = parseM3U(content);
    expect(tracks).toEqual([
      { artist: "Artist One", title: "Song One", durationMs: 240_000 },
      { artist: "Artist Two", title: "Song Two", durationMs: 180_000 },
    ]);
  });

  it("handles missing duration gracefully", () => {
    const content = "#EXTINF:-1,Some Artist - Some Track\nfile.mp3";
    const tracks = parseM3U(content);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].durationMs).toBeUndefined();
  });

  it("skips lines without artist-title separator", () => {
    const content = "#EXTINF:100,Just A Title Without Dash\nfile.mp3";
    const tracks = parseM3U(content);
    expect(tracks).toEqual([]);
  });

  it("returns empty for empty content", () => {
    expect(parseM3U("")).toEqual([]);
    expect(parseM3U("#EXTM3U\n")).toEqual([]);
  });

  it("handles windows line endings", () => {
    const content = "#EXTINF:200,Art - Title\r\nfile.mp3\r\n";
    const tracks = parseM3U(content);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].artist).toBe("Art");
  });
});

// ---------------------------------------------------------------------------
// parseCSV
// ---------------------------------------------------------------------------
describe("parseCSV", () => {
  it("parses basic CSV with artist and title columns", () => {
    const content = "artist,title\nArtist A,Song A\nArtist B,Song B";
    const tracks = parseCSV(content);
    expect(tracks).toEqual([
      { artist: "Artist A", title: "Song A" },
      { artist: "Artist B", title: "Song B" },
    ]);
  });

  it("supports album, duration, and isrc columns", () => {
    const content = "artist,title,album,duration,isrc\nArt,Track,Album,240,USRC17607839";
    const tracks = parseCSV(content);
    expect(tracks).toEqual([
      { artist: "Art", title: "Track", album: "Album", durationMs: 240_000, isrc: "USRC17607839" },
    ]);
  });

  it("handles duration_ms column", () => {
    const content = "artist,title,duration_ms\nArt,Track,180000";
    const tracks = parseCSV(content);
    expect(tracks[0].durationMs).toBe(180_000);
  });

  it("handles quoted fields with commas", () => {
    const content = 'artist,title\n"Last, First",Song\nArt,"Song, Pt. 2"';
    const tracks = parseCSV(content);
    expect(tracks[0].artist).toBe("Last, First");
    expect(tracks[1].title).toBe("Song, Pt. 2");
  });

  it("handles escaped quotes", () => {
    const content = 'artist,title\n"She said ""hello""",Song';
    const tracks = parseCSV(content);
    expect(tracks[0].artist).toBe('She said "hello"');
  });

  it("skips rows with empty artist or title", () => {
    const content = "artist,title\n,Song\nArt,\nGood,Track";
    const tracks = parseCSV(content);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].artist).toBe("Good");
  });

  it("returns empty without header", () => {
    expect(parseCSV("")).toEqual([]);
    expect(parseCSV("just one line")).toEqual([]);
  });

  it("returns empty when required columns missing", () => {
    const content = "name,album\nFoo,Bar";
    expect(parseCSV(content)).toEqual([]);
  });

  it("is case-insensitive for column headers", () => {
    const content = "Artist,Title,Album\nA,B,C";
    const tracks = parseCSV(content);
    expect(tracks[0]).toEqual({ artist: "A", title: "B", album: "C" });
  });
});

// ---------------------------------------------------------------------------
// parseTXT
// ---------------------------------------------------------------------------
describe("parseTXT", () => {
  it("parses Artist - Title lines", () => {
    const content = "Artist One - Song One\nArtist Two - Song Two";
    const tracks = parseTXT(content);
    expect(tracks).toEqual([
      { artist: "Artist One", title: "Song One" },
      { artist: "Artist Two", title: "Song Two" },
    ]);
  });

  it("skips comments and empty lines", () => {
    const content = "# This is a comment\n\nArt - Track\n  \n# Another comment";
    const tracks = parseTXT(content);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].artist).toBe("Art");
  });

  it("supports em dash separator", () => {
    const content = "Artist — Title";
    const tracks = parseTXT(content);
    expect(tracks).toEqual([{ artist: "Artist", title: "Title" }]);
  });

  it("skips unparseable lines", () => {
    const content = "Just a title without separator\nArt - Track";
    const tracks = parseTXT(content);
    expect(tracks).toHaveLength(1);
  });

  it("returns empty for empty content", () => {
    expect(parseTXT("")).toEqual([]);
    expect(parseTXT("# only comments")).toEqual([]);
  });
});
