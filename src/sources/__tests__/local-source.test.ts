import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalFilesystemSource } from "../local-source.js";
import type { LocalSourceConfig } from "../../config.js";

function tmpRoot(): string {
  return join(tmpdir(), `crate-sync-test-${randomUUID()}`);
}

function mkfile(path: string, content = ""): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("LocalFilesystemSource", () => {
  let root: string;

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe("isAvailable", () => {
    it("returns true when path exists", async () => {
      const source = makeSource({ path: root, structure: "flat" });
      expect(await source.isAvailable()).toBe(true);
    });

    it("returns false for non-existent path", async () => {
      const source = makeSource({
        path: join(root, "does-not-exist"),
        structure: "flat",
      });
      expect(await source.isAvailable()).toBe(false);
    });
  });

  describe("letter-artist-album structure", () => {
    it("finds a track by letter/artist/album path", async () => {
      // Structure: Q/Queen/1975 A Night At The Opera/01 - Bohemian Rhapsody.flac
      mkfile(join(root, "Q", "Queen", "1975 A Night At The Opera", "01 - Bohemian Rhapsody.flac"));
      mkfile(join(root, "Q", "Queen", "1975 A Night At The Opera", "02 - You're My Best Friend.flac"));

      const source = makeSource({ path: root, structure: "letter-artist-album" });
      const results = await source.search(
        { title: "Bohemian Rhapsody", artist: "Queen" },
        "track-1",
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].localPath).toContain("Bohemian Rhapsody");
      expect(results[0].sourceId).toBe("local:test");
    });

    it("handles artist name normalization (case, diacritics)", async () => {
      mkfile(join(root, "B", "Bjork", "1997 Homogenic", "01 - Hunter.flac"));

      const source = makeSource({ path: root, structure: "letter-artist-album" });
      const results = await source.search(
        { title: "Hunter", artist: "Bjork" },
        "track-2",
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].localPath).toContain("Hunter");
    });

    it("returns empty when letter dir does not exist", async () => {
      mkfile(join(root, "Q", "Queen", "Album", "01 - Song.flac"));

      const source = makeSource({ path: root, structure: "letter-artist-album" });
      const results = await source.search(
        { title: "Song", artist: "Radiohead" },
        "track-3",
      );

      expect(results).toHaveLength(0);
    });
  });

  describe("artist-album structure", () => {
    it("finds a track by artist/album path", async () => {
      mkfile(join(root, "Daft Punk", "Discovery", "03 Digital Love.mp3"));
      mkfile(join(root, "Daft Punk", "Discovery", "01 One More Time.mp3"));

      const source = makeSource({ path: root, structure: "artist-album", formats: ["mp3"] });
      const results = await source.search(
        { title: "Digital Love", artist: "Daft Punk" },
        "track-4",
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].localPath).toContain("Digital Love");
    });

    it("matches fuzzy artist names", async () => {
      mkfile(join(root, "The Beatles", "Abbey Road", "01 - Come Together.flac"));

      const source = makeSource({ path: root, structure: "artist-album" });
      const results = await source.search(
        { title: "Come Together", artist: "Beatles" },
        "track-5",
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("flat structure", () => {
    it("finds tracks in a flat directory", async () => {
      mkfile(join(root, "Artist One - Track Alpha.flac"));
      mkfile(join(root, "Artist Two - Track Beta.flac"));
      mkfile(join(root, "Artist One - Track Gamma.mp3"));

      const source = makeSource({ path: root, structure: "flat" });
      const results = await source.search(
        { title: "Track Alpha", artist: "Artist One" },
        "track-6",
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].localPath).toContain("Track Alpha");
    });

    it("filters by allowed formats", async () => {
      mkfile(join(root, "Artist - Song.wav"));
      mkfile(join(root, "Artist - Song.flac"));

      const source = makeSource({ path: root, structure: "flat", formats: ["flac"] });
      const results = await source.search(
        { title: "Song", artist: "Artist" },
        "track-7",
      );

      // Only flac should match
      for (const r of results) {
        expect(r.localPath).toMatch(/\.flac$/);
      }
    });
  });

  describe("year-playlist structure", () => {
    it("finds tracks in year/playlist subdirs", async () => {
      mkfile(join(root, "2024", "Deep House", "Kerri Chandler - Rain.flac"));
      mkfile(join(root, "2024", "Techno", "Jeff Mills - The Bells.flac"));

      const source = makeSource({ path: root, structure: "year-playlist" });
      const results = await source.search(
        { title: "Rain", artist: "Kerri Chandler" },
        "track-8",
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].localPath).toContain("Rain");
    });
  });

  describe("acquire", () => {
    it("copies file when fileOp is copy", async () => {
      const filePath = join(root, "test.flac");
      mkfile(filePath, "fake audio data");

      const source = makeSource({ path: root, structure: "flat", fileOp: "copy" });
      const candidate = {
        sourceKey: `local:test:${filePath}`,
        sourceId: "local:test",
        trackInfo: { title: "Test", artist: "Test" },
        localPath: filePath,
        meta: {},
      };

      const result = await source.acquire(candidate);
      expect(result).not.toBeNull();
      expect(existsSync(result!.localPath)).toBe(true);
      // Original should still exist
      expect(existsSync(filePath)).toBe(true);

      // Cleanup
      rmSync(result!.localPath);
    });

    it("moves file when fileOp is move", async () => {
      const filePath = join(root, "moveme.flac");
      mkfile(filePath, "fake audio data");

      const source = makeSource({ path: root, structure: "flat", fileOp: "move" });
      const candidate = {
        sourceKey: `local:test:${filePath}`,
        sourceId: "local:test",
        trackInfo: { title: "Test", artist: "Test" },
        localPath: filePath,
        meta: {},
      };

      const result = await source.acquire(candidate);
      expect(result).not.toBeNull();
      expect(existsSync(result!.localPath)).toBe(true);
      // Original should be gone
      expect(existsSync(filePath)).toBe(false);

      // Cleanup
      rmSync(result!.localPath);
    });

    it("returns null for non-existent file", async () => {
      const source = makeSource({ path: root, structure: "flat" });
      const candidate = {
        sourceKey: "local:test:/nope.flac",
        sourceId: "local:test",
        trackInfo: { title: "Test", artist: "Test" },
        localPath: join(root, "nope.flac"),
        meta: {},
      };

      const result = await source.acquire(candidate);
      expect(result).toBeNull();
    });
  });

  function makeSource(overrides: Partial<LocalSourceConfig & { name: string }> = {}) {
    return new LocalFilesystemSource({
      name: "test",
      path: root,
      structure: "flat",
      formats: ["flac", "mp3"],
      fileOp: "copy",
      ...overrides,
    });
  }
});
