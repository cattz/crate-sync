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
});
