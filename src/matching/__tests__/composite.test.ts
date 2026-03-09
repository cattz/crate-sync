import { describe, it, expect } from "vitest";
import { CompositeMatchStrategy } from "../composite.js";
import { IsrcMatchStrategy } from "../isrc.js";
import { FuzzyMatchStrategy } from "../fuzzy.js";
import { createMatcher } from "../index.js";
import type { TrackInfo } from "../../types/common.js";
import type { MatchOptions } from "../types.js";

const defaultOptions: MatchOptions = {
  autoAcceptThreshold: 0.85,
  reviewThreshold: 0.6,
};

function makeTrack(overrides: Partial<TrackInfo> & { title: string; artist: string }): TrackInfo {
  return { ...overrides };
}

describe("CompositeMatchStrategy", () => {
  it("ISRC match should short-circuit (skip fuzzy)", () => {
    const strategy = new CompositeMatchStrategy(
      [new IsrcMatchStrategy(), new FuzzyMatchStrategy(defaultOptions)],
      defaultOptions,
    );

    const source = makeTrack({ title: "Test", artist: "Artist", isrc: "USAT21234567" });
    const candidates = [
      makeTrack({ title: "Test", artist: "Artist", isrc: "USAT21234567" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(1.0);
    expect(results[0].confidence).toBe("high");
    // ISRC found a high-confidence match, so it returns ISRC results directly
    expect(results[0].method).toBe("isrc");
  });

  it("fallback to fuzzy when no ISRC — exact match short-circuits on fuzzy", () => {
    const strategy = new CompositeMatchStrategy(
      [new IsrcMatchStrategy(), new FuzzyMatchStrategy(defaultOptions)],
      defaultOptions,
    );

    const source = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen" });
    const candidates = [
      makeTrack({ title: "Bohemian Rhapsody", artist: "Queen" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.85);
    expect(results[0].confidence).toBe("high");
    // Fuzzy produces high confidence, so composite short-circuits returning fuzzy results
    expect(results[0].method).toBe("fuzzy");
  });

  it("fallback merges results when no strategy has high confidence", () => {
    const strategy = new CompositeMatchStrategy(
      [new IsrcMatchStrategy(), new FuzzyMatchStrategy(defaultOptions)],
      defaultOptions,
    );

    // A partial match — same title, different artist — should not be high confidence
    const source = makeTrack({ title: "Yesterday", artist: "The Beatles" });
    const candidates = [
      makeTrack({ title: "Yesterday", artist: "John Smith" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].method).toBe("composite");
  });

  it("results should be deduplicated by candidate", () => {
    const strategy = new CompositeMatchStrategy(
      [new IsrcMatchStrategy(), new FuzzyMatchStrategy(defaultOptions)],
      defaultOptions,
    );

    // Source has no ISRC, so ISRC strategy returns nothing.
    // Only fuzzy produces results. Composite merges keeping best per candidate.
    const source = makeTrack({ title: "Let It Be", artist: "The Beatles" });
    const candidateA = makeTrack({ title: "Let It Be", artist: "The Beatles" });
    const candidateB = makeTrack({ title: "Let It Be", artist: "Beatles" });

    const results = strategy.match(source, [candidateA, candidateB]);

    // Each candidate should appear at most once
    const candidateSet = new Set(results.map((r) => r.candidate));
    expect(candidateSet.size).toBe(results.length);
  });

  it("createMatcher factory should work", () => {
    const matcher = createMatcher(defaultOptions);

    const source = makeTrack({ title: "Yesterday", artist: "The Beatles", isrc: "GBAYE0601477" });
    const candidates = [
      makeTrack({ title: "Yesterday", artist: "The Beatles", isrc: "GBAYE0601477" }),
      makeTrack({ title: "Yesterday", artist: "The Beatles" }),
    ];

    const results = matcher.match(source, candidates);

    // ISRC match should short-circuit with high confidence
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].score).toBe(1.0);
    expect(results[0].confidence).toBe("high");
  });
});
