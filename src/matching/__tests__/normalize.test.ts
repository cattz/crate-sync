import { describe, it, expect } from "vitest";
import {
  normalizeUnicode,
  normalizeBase,
  normalizeArtist,
  removeStopwords,
  stripRemixSuffix,
  normalizeTitle,
} from "../normalize.js";

describe("normalizeUnicode", () => {
  it("strips diacritics", () => {
    expect(normalizeUnicode("Beyoncé")).toBe("Beyonce");
    expect(normalizeUnicode("Sigur Rós")).toBe("Sigur Ros");
    expect(normalizeUnicode("Möterhead")).toBe("Moterhead");
  });

  it("leaves plain ASCII unchanged", () => {
    expect(normalizeUnicode("Queen")).toBe("Queen");
  });
});

describe("normalizeBase", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeBase("Don't Stop Me Now!")).toBe("dont stop me now");
  });

  it("collapses whitespace", () => {
    expect(normalizeBase("  hello   world  ")).toBe("hello world");
  });

  it("handles diacritics", () => {
    expect(normalizeBase("Beyoncé")).toBe("beyonce");
  });
});

describe("normalizeArtist", () => {
  it('strips leading "the"', () => {
    expect(normalizeArtist("The Smiths")).toBe("smiths");
    expect(normalizeArtist("The The")).toBe("the"); // only strips leading "the "
  });

  it('replaces "&" with "and"', () => {
    expect(normalizeArtist("Simon & Garfunkel")).toBe("simon and garfunkel");
  });

  it("combines all normalizations", () => {
    expect(normalizeArtist("The Beastié Boys & Friends")).toBe(
      "beastie boys and friends",
    );
  });
});

describe("removeStopwords", () => {
  it("removes common stopwords", () => {
    const words = new Set(["the", "sound", "of", "music"]);
    const result = removeStopwords(words);
    expect(result).toEqual(new Set(["sound", "music"]));
  });

  it("returns original set if all words are stopwords", () => {
    const words = new Set(["the", "a", "of"]);
    const result = removeStopwords(words);
    expect(result).toEqual(words);
  });
});

describe("stripRemixSuffix", () => {
  it('strips " - Remix" suffix', () => {
    expect(stripRemixSuffix("Blue Monday - 2023 Remix")).toBe("Blue Monday");
  });

  it("strips parenthesized remix info", () => {
    expect(stripRemixSuffix("Blue Monday (Radio Edit)")).toBe("Blue Monday");
  });

  it("strips remastered suffix", () => {
    expect(stripRemixSuffix("Heroes - 2017 Remastered")).toBe("Heroes");
  });

  it("leaves non-remix titles unchanged", () => {
    expect(stripRemixSuffix("Blue Monday")).toBe("Blue Monday");
    expect(stripRemixSuffix("Blue Monday - Part 2")).toBe(
      "Blue Monday - Part 2",
    );
  });

  it("handles parenthesized non-remix info", () => {
    expect(stripRemixSuffix("Yesterday (From the Album Help)")).toBe(
      "Yesterday (From the Album Help)",
    );
  });
});

describe("normalizeTitle", () => {
  it("strips parenthetical content", () => {
    expect(normalizeTitle("Feels This Good (TMU Intro) (Clean)")).toBe(
      "Feels This Good",
    );
  });

  it("strips bracket content", () => {
    expect(normalizeTitle("Track Name [Radio Edit]")).toBe("Track Name");
  });

  it("strips trailing key/BPM patterns", () => {
    expect(normalizeTitle("Track Name 4A 107")).toBe("Track Name");
  });

  it("strips feat. credits", () => {
    expect(normalizeTitle("Song feat. Artist")).toBe("Song");
  });

  it("strips ft. credits", () => {
    expect(normalizeTitle("Song ft. Another Artist")).toBe("Song");
  });

  it("preserves title when nothing to strip", () => {
    expect(normalizeTitle("Just a Normal Title")).toBe("Just a Normal Title");
  });

  it("returns original if everything would be stripped", () => {
    // A title that is entirely parenthetical — fallback to original
    expect(normalizeTitle("(Intro)")).toBe("(Intro)");
  });
});
