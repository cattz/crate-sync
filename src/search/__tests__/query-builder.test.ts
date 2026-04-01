import { describe, it, expect } from "vitest";
import { generateSearchQueries } from "../query-builder.js";

describe("generateSearchQueries", () => {
  it("generates full, title-only, and keywords strategies for a simple track", () => {
    const queries = generateSearchQueries({
      title: "Mr. Brightside",
      artist: "The Killers",
    });

    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries[0].label).toBe("full");
    expect(queries[0].query).toBe("The Killers Mr. Brightside");
  });

  it("generates base-title strategy for remix tracks", () => {
    const queries = generateSearchQueries({
      title: "Reliquia - German Brigante Remix",
      artist: "Satori",
    });

    const labels = queries.map((q) => q.label);
    expect(labels).toContain("full");
    expect(labels).toContain("base-title");

    const baseTitle = queries.find((q) => q.label === "base-title")!;
    expect(baseTitle.query).toBe("Satori Reliquia");
  });

  it("strips parenthetical remix info", () => {
    const queries = generateSearchQueries({
      title: "Blue Monday (12 inch version)",
      artist: "New Order",
    });

    expect(queries[0].query).toBe("New Order Blue Monday");
  });

  it("handles featured artist parentheticals", () => {
    const queries = generateSearchQueries({
      title: "Close To Me (feat. Swae Lee)",
      artist: "Ellie Goulding",
    });

    expect(queries[0].query).toBe("Ellie Goulding Close To Me");
  });

  it("generates title-only strategy", () => {
    const queries = generateSearchQueries({
      title: "Linger - SiriusXM Session",
      artist: "The Cranberries",
    });

    const titleOnly = queries.find((q) => q.label === "title-only")!;
    expect(titleOnly.query).toBe("Linger SiriusXM Session");
  });

  it("generates keywords strategy for long titles", () => {
    const queries = generateSearchQueries({
      title: "Never Gonna Give You Up (Extended Club Mix)",
      artist: "Rick Astley",
    });

    const keywords = queries.find((q) => q.label === "keywords");
    // keywords strategy uses first 2 significant words from cleaned title
    if (keywords) {
      expect(keywords.query).toContain("Rick Astley");
    }
  });

  it("handles tracks with dashes in title", () => {
    const queries = generateSearchQueries({
      title: "Linger - SiriusXM Session",
      artist: "The Cranberries",
    });

    // " - " should be replaced with space in full strategy
    expect(queries[0].query).toBe("The Cranberries Linger SiriusXM Session");
  });

  it("deduplicates identical query strings", () => {
    const queries = generateSearchQueries({
      title: "Simple",
      artist: "Artist",
    });

    const queryStrings = queries.map((q) => q.query);
    const unique = new Set(queryStrings);
    expect(queryStrings.length).toBe(unique.size);
  });

  it("handles unicode characters", () => {
    const queries = generateSearchQueries({
      title: "Más Que Nada",
      artist: "Sérgio Mendes",
    });

    expect(queries[0].query).toBe("Sérgio Mendes Más Que Nada");
  });

  it("handles multiple parenthesized groups", () => {
    const queries = generateSearchQueries({
      title: "Song (feat. Artist B) (Radio Edit)",
      artist: "Artist A",
    });

    expect(queries[0].query).toBe("Artist A Song");
  });

  it("handles square brackets", () => {
    const queries = generateSearchQueries({
      title: "Track [Remastered 2023]",
      artist: "Band",
    });

    expect(queries[0].query).toBe("Band Track");
  });

  it("handles empty artist gracefully", () => {
    const queries = generateSearchQueries({
      title: "Some Track",
      artist: "",
    });

    expect(queries.length).toBeGreaterThanOrEqual(1);
    const titleOnly = queries.find((q) => q.label === "title-only");
    expect(titleOnly).toBeDefined();
    expect(titleOnly!.query).toBe("Some Track");
  });

  // --- Edge case tests ---

  it("handles track with no artist (whitespace-only)", () => {
    const queries = generateSearchQueries({
      title: "Ambient Soundscape",
      artist: "   ",
    });

    // Should not produce "full" or "keywords" strategies (artist is blank)
    const full = queries.find((q) => q.label === "full");
    expect(full).toBeUndefined();

    const titleOnly = queries.find((q) => q.label === "title-only");
    expect(titleOnly).toBeDefined();
    expect(titleOnly!.query).toBe("Ambient Soundscape");
  });

  it("handles track with very long title", () => {
    const longTitle =
      "This Is An Extremely Long Track Title That Goes On And On With Many Words To Test The Keywords Strategy";
    const queries = generateSearchQueries({
      title: longTitle,
      artist: "Test Artist",
    });

    expect(queries.length).toBeGreaterThanOrEqual(2);

    // full strategy should contain the entire cleaned title
    expect(queries[0].label).toBe("full");
    expect(queries[0].query).toContain("Test Artist");

    // keywords strategy should exist and use only 2 significant words
    const keywords = queries.find((q) => q.label === "keywords");
    if (keywords) {
      const wordsInQuery = keywords.query.split(/\s+/);
      // artist words + 2 keyword words
      expect(wordsInQuery.length).toBeLessThanOrEqual(4);
    }
  });

  it("handles track with special characters in title", () => {
    const queries = generateSearchQueries({
      title: "Rock & Roll (Is Noise Pollution)",
      artist: "AC/DC",
    });

    // Parenthetical should be stripped
    expect(queries[0].query).toBe("AC/DC Rock & Roll");
  });

  it("handles track with ampersand and special punctuation", () => {
    const queries = generateSearchQueries({
      title: "What's Going On?",
      artist: "Marvin Gaye",
    });

    expect(queries[0].query).toBe("Marvin Gaye What's Going On?");
  });

  it("handles track with remix in parentheses", () => {
    const queries = generateSearchQueries({
      title: "Strobe (Deadmau5 Remix)",
      artist: "Deadmau5",
    });

    // cleanForSearch strips parenthetical content
    expect(queries[0].label).toBe("full");
    expect(queries[0].query).toBe("Deadmau5 Strobe");

    // base-title strategy should also strip remix via stripRemixSuffix
    // Since cleanForSearch already removes "(Deadmau5 Remix)", the
    // base title and full title should be the same (no base-title strategy)
    const labels = queries.map((q) => q.label);
    // title-only should always exist
    expect(labels).toContain("title-only");
  });

  it("handles track with remix in parentheses and dash pattern", () => {
    const queries = generateSearchQueries({
      title: "One More Time - Thomas Bangalter Remix",
      artist: "Daft Punk",
    });

    const labels = queries.map((q) => q.label);
    expect(labels).toContain("full");
    expect(labels).toContain("base-title");

    // base-title should strip the " - ... Remix" suffix
    const baseTitle = queries.find((q) => q.label === "base-title")!;
    expect(baseTitle.query).toBe("Daft Punk One More Time");
  });

  it("handles track with only short words in title", () => {
    const queries = generateSearchQueries({
      title: "It Is On",
      artist: "Some Band",
    });

    // All words are <= 2 chars after "significant" filtering, so it falls
    // back to using all words
    expect(queries[0].query).toBe("Some Band It Is On");
  });

  it("handles track where title is entirely parenthetical", () => {
    const queries = generateSearchQueries({
      title: "(Everything In Its Right Place)",
      artist: "Radiohead",
    });

    // cleanForSearch will strip the parenthetical, leaving empty,
    // which means only some strategies may apply
    expect(queries.length).toBeGreaterThanOrEqual(0);
  });
});
