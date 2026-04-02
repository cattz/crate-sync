import { existsSync } from "node:fs";
import type { Config } from "../config.js";
import type { TrackSource } from "./types.js";
import { LocalFilesystemSource } from "./local-source.js";

/**
 * Build an ordered list of TrackSources based on config priority.
 * Sources whose paths don't exist are silently skipped.
 */
export function buildSources(config: Config): TrackSource[] {
  const sources: TrackSource[] = [];
  const priority = config.sources?.priority ?? ["soulseek"];

  for (const sourceId of priority) {
    if (sourceId === "soulseek") {
      // SoulseekSource will be created in a separate phase.
      continue;
    }

    if (sourceId.startsWith("local:")) {
      const name = sourceId.slice(6);
      const localConfig = config.sources?.local?.[name];
      if (localConfig && existsSync(localConfig.path)) {
        sources.push(new LocalFilesystemSource({ ...localConfig, name }));
      }
    }
  }

  return sources;
}
