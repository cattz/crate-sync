import type { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { loadConfig } from "../config.js";
import { LexiconService } from "../services/lexicon-service.js";
import type { LexiconTrack } from "../types/lexicon.js";

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "\u2014";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description("Interactively review pending matches")
    .action(async () => {
      const db = getDb();

      // Fetch all pending matches (spotify → lexicon)
      const pendingMatches = db
        .select()
        .from(schema.matches)
        .where(
          and(
            eq(schema.matches.status, "pending"),
            eq(schema.matches.sourceType, "spotify"),
            eq(schema.matches.targetType, "lexicon"),
          ),
        )
        .all();

      if (pendingMatches.length === 0) {
        console.log(chalk.dim("No pending matches to review."));
        return;
      }

      console.log(chalk.bold(`${pendingMatches.length} pending match(es) to review`));
      console.log();

      // Fetch Lexicon tracks for target enrichment
      const lexiconTargetIds = new Set(pendingMatches.map((m) => m.targetId));
      let lexiconById = new Map<string, LexiconTrack>();

      try {
        const config = loadConfig();
        const lexicon = new LexiconService(config.lexicon);
        console.log(chalk.dim("  Fetching Lexicon library..."));
        const allTracks = await lexicon.getTracks();
        for (const lt of allTracks) {
          if (lexiconTargetIds.has(lt.id)) {
            lexiconById.set(lt.id, lt);
          }
        }
        console.log(chalk.dim(`  Loaded ${lexiconById.size} target track(s)`));
        console.log();
      } catch {
        console.log(chalk.yellow("  Warning: Lexicon not available — target details will be limited"));
        console.log();
      }

      const rl = createInterface({ input: stdin, output: stdout });
      let confirmed = 0;
      let rejected = 0;

      try {
        for (let i = 0; i < pendingMatches.length; i++) {
          const match = pendingMatches[i];
          const score = (match.score * 100).toFixed(0);

          // Look up source (Spotify) track
          const srcTrack = db
            .select()
            .from(schema.tracks)
            .where(eq(schema.tracks.id, match.sourceId))
            .get();

          // Look up target (Lexicon) track from API data
          const tgtTrack = lexiconById.get(match.targetId) ?? null;

          console.log(
            chalk.bold(
              `  [${i + 1}/${pendingMatches.length}] Match at ${chalk.yellow(`${score}%`)} (${match.method})`,
            ),
          );
          console.log();

          // Source info
          if (srcTrack) {
            console.log(`    ${chalk.cyan("Spotify:")}  ${srcTrack.artist} \u2014 ${srcTrack.title}`);
            if (srcTrack.album) console.log(`               ${chalk.dim(`Album: ${srcTrack.album}`)}`);
            console.log(`               ${chalk.dim(`Duration: ${formatDuration(srcTrack.durationMs)}`)}`);
            if (srcTrack.isrc) console.log(`               ${chalk.dim(`ISRC: ${srcTrack.isrc}`)}`);
          } else {
            console.log(`    ${chalk.cyan("Spotify:")}  ${chalk.dim(match.sourceId)}`);
          }

          console.log();

          // Target info
          if (tgtTrack) {
            console.log(`    ${chalk.magenta("Lexicon:")}  ${tgtTrack.artist} \u2014 ${tgtTrack.title}`);
            if (tgtTrack.album) console.log(`               ${chalk.dim(`Album: ${tgtTrack.album}`)}`);
            console.log(`               ${chalk.dim(`Duration: ${formatDuration(tgtTrack.durationMs)}`)}`);
            console.log(`               ${chalk.dim(`File: ${tgtTrack.filePath}`)}`);
          } else {
            console.log(`    ${chalk.magenta("Lexicon:")}  ${chalk.dim(match.targetId)}`);
          }

          console.log();

          const answer = await rl.question(
            chalk.bold("  Accept? (y/n/a=all/q=quit/s=skip): "),
          );
          const choice = answer.trim().toLowerCase();

          if (choice === "a") {
            // Accept this and all remaining
            for (let j = i; j < pendingMatches.length; j++) {
              db.update(schema.matches)
                .set({ status: "confirmed", updatedAt: Date.now() })
                .where(eq(schema.matches.id, pendingMatches[j].id))
                .run();
              confirmed++;
            }
            break;
          } else if (choice === "q") {
            break;
          } else if (choice === "s") {
            // skip — leave as pending
            console.log();
            continue;
          } else if (choice === "y" || choice === "yes") {
            db.update(schema.matches)
              .set({ status: "confirmed", updatedAt: Date.now() })
              .where(eq(schema.matches.id, match.id))
              .run();
            confirmed++;
          } else {
            db.update(schema.matches)
              .set({ status: "rejected", updatedAt: Date.now() })
              .where(eq(schema.matches.id, match.id))
              .run();
            rejected++;
          }

          console.log();
        }
      } finally {
        rl.close();
      }

      console.log();
      console.log(
        `  Confirmed ${chalk.green(String(confirmed))}, rejected ${chalk.red(String(rejected))}`,
      );
    });
}
