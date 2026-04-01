import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

let mockFileExists = false;
let mockFileContent = "{}";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => mockFileExists),
  readFileSync: vi.fn(() => mockFileContent),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { loadConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  beforeEach(() => {
    mockFileExists = false;
    mockFileContent = "{}";
  });

  it("returns defaults when no config file exists", () => {
    mockFileExists = false;
    const config = loadConfig();

    expect(config.spotify.clientId).toBe("");
    expect(config.spotify.redirectUri).toBe("http://127.0.0.1:8888/callback");
    expect(config.lexicon.url).toBe("http://localhost:48624");
    expect(config.soulseek.slskdUrl).toBe("http://localhost:5030");
    expect(config.soulseek.searchDelayMs).toBe(5000);
    expect(config.download.formats).toEqual(["flac", "mp3"]);
    expect(config.download.minBitrate).toBe(320);
    expect(config.download.concurrency).toBe(3);
  });

  it("notFoundThreshold defaults to 0.65", () => {
    mockFileExists = false;
    const config = loadConfig();
    expect(config.matching.notFoundThreshold).toBe(0.65);
  });

  it("logging.level defaults to 'info'", () => {
    mockFileExists = false;
    const config = loadConfig();
    expect(config.logging.level).toBe("info");
  });

  it("jobRunner.retentionDays defaults to 7", () => {
    mockFileExists = false;
    const config = loadConfig();
    expect(config.jobRunner.retentionDays).toBe(7);
  });
});

describe("mergeDefaults (via loadConfig)", () => {
  beforeEach(() => {
    mockFileExists = true;
  });

  it("merges partial top-level config with defaults", () => {
    mockFileContent = JSON.stringify({
      spotify: { clientId: "my-id" },
    });
    const config = loadConfig();

    expect(config.spotify.clientId).toBe("my-id");
    // Other spotify fields keep defaults
    expect(config.spotify.clientSecret).toBe("");
    expect(config.spotify.redirectUri).toBe("http://127.0.0.1:8888/callback");
  });

  it("merges nested tagCategory object", () => {
    mockFileContent = JSON.stringify({
      lexicon: {
        tagCategory: { name: "Custom Tags" },
      },
    });
    const config = loadConfig();

    expect(config.lexicon.tagCategory.name).toBe("Custom Tags");
    // color keeps default
    expect(config.lexicon.tagCategory.color).toBe("#1DB954");
  });

  it("merges nested lexiconWeights", () => {
    mockFileContent = JSON.stringify({
      matching: {
        lexiconWeights: { title: 0.5 },
      },
    });
    const config = loadConfig();

    expect(config.matching.lexiconWeights.title).toBe(0.5);
    // Other weights keep defaults
    expect(config.matching.lexiconWeights.artist).toBe(0.3);
    expect(config.matching.lexiconWeights.album).toBe(0.15);
    expect(config.matching.lexiconWeights.duration).toBe(0.25);
  });

  it("merges nested soulseekWeights", () => {
    mockFileContent = JSON.stringify({
      matching: {
        soulseekWeights: { duration: 0.5 },
      },
    });
    const config = loadConfig();

    expect(config.matching.soulseekWeights.duration).toBe(0.5);
    // Other weights keep defaults
    expect(config.matching.soulseekWeights.title).toBe(0.3);
    expect(config.matching.soulseekWeights.artist).toBe(0.25);
    expect(config.matching.soulseekWeights.album).toBe(0.1);
  });

  it("preserves notFoundThreshold when not overridden", () => {
    mockFileContent = JSON.stringify({
      matching: { autoAcceptThreshold: 0.95 },
    });
    const config = loadConfig();

    expect(config.matching.autoAcceptThreshold).toBe(0.95);
    expect(config.matching.notFoundThreshold).toBe(0.65);
  });

  it("overrides notFoundThreshold when specified", () => {
    mockFileContent = JSON.stringify({
      matching: { notFoundThreshold: 0.8 },
    });
    const config = loadConfig();

    expect(config.matching.notFoundThreshold).toBe(0.8);
  });
});

describe("path expansion", () => {
  beforeEach(() => {
    mockFileExists = true;
  });

  it("expands ~ in downloadRoot", () => {
    mockFileContent = JSON.stringify({
      lexicon: { downloadRoot: "~/Music/downloads" },
    });
    const config = loadConfig();

    const expected = `${homedir()}/Music/downloads`;
    expect(config.lexicon.downloadRoot).toBe(expected);
  });

  it("expands ~ in downloadDir", () => {
    mockFileContent = JSON.stringify({
      soulseek: { downloadDir: "~/slskd/downloads" },
    });
    const config = loadConfig();

    const expected = `${homedir()}/slskd/downloads`;
    expect(config.soulseek.downloadDir).toBe(expected);
  });

  it("leaves absolute paths unchanged", () => {
    mockFileContent = JSON.stringify({
      lexicon: { downloadRoot: "/absolute/path" },
      soulseek: { downloadDir: "/other/absolute" },
    });
    const config = loadConfig();

    expect(config.lexicon.downloadRoot).toBe("/absolute/path");
    expect(config.soulseek.downloadDir).toBe("/other/absolute");
  });

  it("leaves empty paths unchanged", () => {
    mockFileContent = JSON.stringify({});
    const config = loadConfig();

    expect(config.lexicon.downloadRoot).toBe("");
    expect(config.soulseek.downloadDir).toBe("");
  });
});
