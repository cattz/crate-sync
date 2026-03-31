export type {
  MatchStrategy,
  MatchOptions,
  MatchContext,
  WeightProfile,
  FuzzyMatchConfig,
} from "./types.js";
export { IsrcMatchStrategy } from "./isrc.js";
export { FuzzyMatchStrategy } from "./fuzzy.js";
export { CompositeMatchStrategy } from "./composite.js";

import type { MatchStrategy, MatchOptions, MatchContext, WeightProfile } from "./types.js";
import { IsrcMatchStrategy } from "./isrc.js";
import { FuzzyMatchStrategy } from "./fuzzy.js";
import { CompositeMatchStrategy } from "./composite.js";

export function createMatcher(
  options: MatchOptions,
  context?: MatchContext,
  weights?: WeightProfile,
): MatchStrategy {
  return new CompositeMatchStrategy(
    [new IsrcMatchStrategy(), new FuzzyMatchStrategy({ ...options, context, weights })],
    options,
  );
}
