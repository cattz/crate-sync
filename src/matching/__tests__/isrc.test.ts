import { describe, it, expect } from "vitest";
import { IsrcMatchStrategy } from "../isrc.js";
import type { TrackInfo } from "../../types/common.js";

function makeTrack(overrides: Partial<TrackInfo> & { title: string; artist: string }): TrackInfo {
  return { ...overrides };
}

describe("IsrcMatchStrategy", () => {
  const strategy = new IsrcMatchStrategy();

  it("matching ISRC should return score 1.0", () => {
    const source = makeTrack({ title: "Test", artist: "Artist", isrc: "USAT21234567" });
    const candidates = [
      makeTrack({ title: "Test", artist: "Artist", isrc: "USAT21234567" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(1.0);
    expect(results[0].confidence).toBe("high");
    expect(results[0].method).toBe("isrc");
  });

  it("no ISRC on source should return empty", () => {
    const source = makeTrack({ title: "Test", artist: "Artist" });
    const candidates = [
      makeTrack({ title: "Test", artist: "Artist", isrc: "USAT21234567" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(0);
  });

  it("no matching ISRC in candidates should return empty", () => {
    const source = makeTrack({ title: "Test", artist: "Artist", isrc: "USAT21234567" });
    const candidates = [
      makeTrack({ title: "Test", artist: "Artist", isrc: "GBAYE9800023" }),
      makeTrack({ title: "Other", artist: "Other" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(0);
  });

  it("multiple candidates with same ISRC should all be returned", () => {
    const source = makeTrack({ title: "Test", artist: "Artist", isrc: "USAT21234567" });
    const candidates = [
      makeTrack({ title: "Test", artist: "Artist", isrc: "USAT21234567" }),
      makeTrack({ title: "Test (Remaster)", artist: "Artist", isrc: "USAT21234567" }),
      makeTrack({ title: "Different", artist: "Different", isrc: "GBAYE9800023" }),
    ];

    const results = strategy.match(source, candidates);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.score === 1.0)).toBe(true);
    expect(results.every((r) => r.confidence === "high")).toBe(true);
  });
});
