import { describe, it, expect } from "vitest";
import { FuzzyMatchStrategy } from "../fuzzy.js";
import type { TrackInfo } from "../../types/common.js";
import type { MatchOptions } from "../types.js";

const defaultOptions: MatchOptions = {
  autoAcceptThreshold: 0.85,
  reviewThreshold: 0.6,
};

function makeTrack(overrides: Partial<TrackInfo> & { title: string; artist: string }): TrackInfo {
  return { ...overrides };
}

describe("FuzzyMatchStrategy", () => {
  const strategy = new FuzzyMatchStrategy(defaultOptions);

  it("exact match should score ~1.0 with high confidence", () => {
    const source = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen", durationMs: 354000 });
    const candidates = [
      makeTrack({ title: "Bohemian Rhapsody", artist: "Queen", durationMs: 354000 }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.95);
    expect(results[0].confidence).toBe("high");
    expect(results[0].method).toBe("fuzzy");
  });

  it("close match with small typo should score high", () => {
    const source = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen" });
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
    // Title matches (0.5 weight) but artist doesn't (0.4 weight)
    expect(results[0].score).toBeGreaterThan(0.3);
    expect(results[0].score).toBeLessThan(0.85);
  });

  it("completely different track should score low or not appear", () => {
    const source = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen" });
    const candidates = [
      makeTrack({ title: "Stairway to Heaven", artist: "Led Zeppelin" }),
    ];

    const results = strategy.match(source, candidates);

    if (results.length > 0) {
      expect(results[0].score).toBeLessThan(0.3);
    } else {
      expect(results).toHaveLength(0);
    }
  });

  it("duration penalty: same title+artist but very different duration should lower score", () => {
    const source = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen", durationMs: 354000 });
    const sameDuration = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen", durationMs: 355000 });
    const differentDuration = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen", durationMs: 60000 });

    const resultsClose = strategy.match(source, [sameDuration]);
    const resultsFar = strategy.match(source, [differentDuration]);

    expect(resultsClose).toHaveLength(1);
    expect(resultsFar).toHaveLength(1);
    expect(resultsClose[0].score).toBeGreaterThan(resultsFar[0].score);
  });

  it('normalization: "The Beatles" vs "the beatles" should match', () => {
    const source = makeTrack({ title: "Let It Be", artist: "The Beatles" });
    const candidates = [
      makeTrack({ title: "let it be", artist: "the beatles" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.95);
    expect(results[0].confidence).toBe("high");
  });

  it("normalization: extra punctuation should not prevent match", () => {
    const source = makeTrack({ title: "Don't Stop Me Now", artist: "Queen" });
    const candidates = [
      makeTrack({ title: "Dont Stop Me Now", artist: "Queen" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.85);
  });

  it("empty candidates should return empty results", () => {
    const source = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen" });
    const results = strategy.match(source, []);

    expect(results).toHaveLength(0);
  });
});
