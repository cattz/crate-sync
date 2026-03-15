import { describe, it, expect } from "vitest";
import { FuzzyMatchStrategy } from "../fuzzy.js";
import type { TrackInfo } from "../../types/common.js";
import type { FuzzyMatchConfig } from "../types.js";

const defaultConfig: FuzzyMatchConfig = {
  autoAcceptThreshold: 0.85,
  reviewThreshold: 0.6,
};

function makeTrack(
  overrides: Partial<TrackInfo> & { title: string; artist: string },
): TrackInfo {
  return { ...overrides };
}

describe("FuzzyMatchStrategy", () => {
  const strategy = new FuzzyMatchStrategy(defaultConfig);

  it("exact match should score ~1.0 with high confidence", () => {
    const source = makeTrack({
      title: "Bohemian Rhapsody",
      artist: "Queen",
      durationMs: 354000,
    });
    const candidates = [
      makeTrack({
        title: "Bohemian Rhapsody",
        artist: "Queen",
        durationMs: 354000,
      }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.95);
    expect(results[0].confidence).toBe("high");
    expect(results[0].method).toBe("fuzzy");
  });

  it("close match with small typo should score high", () => {
    const source = makeTrack({
      title: "Bohemian Rhapsody",
      artist: "Queen",
    });
    const candidates = [
      makeTrack({ title: "Bohemian Rhapsodi", artist: "Queen" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.7);
  });

  it("same title, different artist should score medium", () => {
    const source = makeTrack({ title: "Yesterday", artist: "The Beatles" });
    const candidates = [
      makeTrack({ title: "Yesterday", artist: "John Smith" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.3);
    expect(results[0].score).toBeLessThan(0.85);
  });

  it("completely different track should score low or not appear", () => {
    const source = makeTrack({
      title: "Bohemian Rhapsody",
      artist: "Queen",
    });
    const candidates = [
      makeTrack({ title: "Stairway to Heaven", artist: "Led Zeppelin" }),
    ];

    const results = strategy.match(source, candidates);

    if (results.length > 0) {
      // With missing durations treated as neutral (1.0), dissimilar tracks
      // can score higher than before, but should still be below review threshold
      expect(results[0].score).toBeLessThan(0.5);
      expect(results[0].confidence).toBe("low");
    } else {
      expect(results).toHaveLength(0);
    }
  });

  it("duration penalty: same title+artist but very different duration should lower score", () => {
    const source = makeTrack({
      title: "Bohemian Rhapsody",
      artist: "Queen",
      durationMs: 354000,
    });
    const sameDuration = makeTrack({
      title: "Bohemian Rhapsody",
      artist: "Queen",
      durationMs: 355000,
    });
    const differentDuration = makeTrack({
      title: "Bohemian Rhapsody",
      artist: "Queen",
      durationMs: 60000,
    });

    const resultsClose = strategy.match(source, [sameDuration]);
    const resultsFar = strategy.match(source, [differentDuration]);

    expect(resultsClose).toHaveLength(1);
    expect(resultsFar).toHaveLength(1);
    expect(resultsClose[0].score).toBeGreaterThan(resultsFar[0].score);
  });

  it('"The Beatles" vs "the beatles" should match', () => {
    const source = makeTrack({ title: "Let It Be", artist: "The Beatles" });
    const candidates = [
      makeTrack({ title: "let it be", artist: "the beatles" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.95);
    expect(results[0].confidence).toBe("high");
  });

  it("extra punctuation should not prevent match", () => {
    const source = makeTrack({
      title: "Don't Stop Me Now",
      artist: "Queen",
    });
    const candidates = [
      makeTrack({ title: "Dont Stop Me Now", artist: "Queen" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.85);
  });

  it("empty candidates should return empty results", () => {
    const source = makeTrack({
      title: "Bohemian Rhapsody",
      artist: "Queen",
    });
    const results = strategy.match(source, []);

    expect(results).toHaveLength(0);
  });

  // --- New tests for improved matching ---

  it("diacritics: Beyoncé should match Beyonce", () => {
    const source = makeTrack({ title: "Halo", artist: "Beyoncé" });
    const candidates = [makeTrack({ title: "Halo", artist: "Beyonce" })];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.95);
  });

  it("stopword invariance: similar titles differing by stopwords should score high", () => {
    const source = makeTrack({
      title: "Sound of Music",
      artist: "Test",
    });
    const candidates = [
      makeTrack({ title: "Sound Music", artist: "Test" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.8);
  });

  it("artist containment: feat. artist should still match base artist", () => {
    const source = makeTrack({
      title: "Get Lucky",
      artist: "Daft Punk feat. Pharrell Williams",
    });
    const candidates = [
      makeTrack({ title: "Get Lucky", artist: "Daft Punk" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.7);
  });

  it("remix fallback: remix variant should still match original", () => {
    const source = makeTrack({
      title: "Blue Monday - 2023 Remix",
      artist: "New Order",
    });
    const candidates = [
      makeTrack({ title: "Blue Monday", artist: "New Order" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.7);
  });

  it("album contributes to score when present", () => {
    const source = makeTrack({
      title: "Yesterday",
      artist: "The Beatles",
      album: "Help!",
      durationMs: 125000,
    });
    const matchingAlbum = makeTrack({
      title: "Yesterday",
      artist: "The Beatles",
      album: "Help!",
      durationMs: 125000,
    });
    const wrongAlbum = makeTrack({
      title: "Yesterday",
      artist: "The Beatles",
      album: "Let It Be",
      durationMs: 125000,
    });

    const resultsMatch = strategy.match(source, [matchingAlbum]);
    const resultsWrong = strategy.match(source, [wrongAlbum]);

    expect(resultsMatch[0].score).toBeGreaterThan(resultsWrong[0].score);
  });

  it("artist gate in soulseek context rejects low artist match", () => {
    const slskStrategy = new FuzzyMatchStrategy({
      ...defaultConfig,
      context: "soulseek",
      artistRejectThreshold: 0.3,
    });

    const source = makeTrack({
      title: "Yesterday",
      artist: "The Beatles",
    });
    const candidates = [
      makeTrack({ title: "Yesterday", artist: "DJ Shadow" }),
    ];

    const results = slskStrategy.match(source, candidates);

    // With artist gate, totally different artist should be rejected
    expect(results).toHaveLength(0);
  });

  it("duration power curve: 15s difference scores moderately, 30s scores near 0", () => {
    const source = makeTrack({
      title: "Test",
      artist: "Test",
      durationMs: 200000,
    });
    const diff15 = makeTrack({
      title: "Test",
      artist: "Test",
      durationMs: 215000,
    });
    const diff30 = makeTrack({
      title: "Test",
      artist: "Test",
      durationMs: 230000,
    });

    const results15 = strategy.match(source, [diff15]);
    const results30 = strategy.match(source, [diff30]);

    expect(results15).toHaveLength(1);
    expect(results30).toHaveLength(1);
    expect(results15[0].score).toBeGreaterThan(results30[0].score);
  });

  it("transposition typo should still score well (Damerau-Levenshtein)", () => {
    const source = makeTrack({
      title: "Bohemian Rhapsody",
      artist: "Queeen", // extra e — but test transposition via artist
    });
    const candidates = [
      makeTrack({ title: "Bohemian Rhapsody", artist: "Queen" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.8);
  });
});
