export type { MatchStrategy, MatchOptions } from "./types.js";
export { IsrcMatchStrategy } from "./isrc.js";
export { FuzzyMatchStrategy } from "./fuzzy.js";
export { CompositeMatchStrategy } from "./composite.js";

import type { MatchStrategy, MatchOptions } from "./types.js";
import { IsrcMatchStrategy } from "./isrc.js";
import { FuzzyMatchStrategy } from "./fuzzy.js";
import { CompositeMatchStrategy } from "./composite.js";

export function createMatcher(options: MatchOptions): MatchStrategy {
  return new CompositeMatchStrategy(
    [new IsrcMatchStrategy(), new FuzzyMatchStrategy(options)],
    options,
  );
}
