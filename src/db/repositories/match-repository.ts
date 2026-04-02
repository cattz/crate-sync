import { eq, and, sql } from "drizzle-orm";
import { matches, type Match, type NewMatch } from "../schema.js";
import type { IMatchRepository } from "../../ports/repositories.js";
import type { getDb } from "../client.js";

type Db = ReturnType<typeof getDb>;

export class DrizzleMatchRepository implements IMatchRepository {
  constructor(private db: Db) {}

  findById(id: string): Match | null {
    return (
      this.db
        .select()
        .from(matches)
        .where(eq(matches.id, id))
        .get() ?? null
    );
  }

  findBySourceAndTargetType(
    sourceType: string,
    targetType: string,
  ): Match[] {
    return this.db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.sourceType, sourceType as Match["sourceType"]),
          eq(matches.targetType, targetType as Match["targetType"]),
        ),
      )
      .all();
  }

  findBySourceIdAndTargetType(
    sourceType: string,
    sourceId: string,
    targetType: string,
  ): Match[] {
    return this.db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.sourceType, sourceType as Match["sourceType"]),
          eq(matches.sourceId, sourceId),
          eq(matches.targetType, targetType as Match["targetType"]),
        ),
      )
      .all();
  }

  findByStatus(
    status: string,
    sourceType?: string,
    targetType?: string,
  ): Match[] {
    const conditions = [eq(matches.status, status as Match["status"])];
    if (sourceType) {
      conditions.push(eq(matches.sourceType, sourceType as Match["sourceType"]));
    }
    if (targetType) {
      conditions.push(eq(matches.targetType, targetType as Match["targetType"]));
    }
    return this.db
      .select()
      .from(matches)
      .where(and(...conditions))
      .all();
  }

  /**
   * Upsert a match with conflict-resolution:
   * - Never downgrade confirmed → pending/rejected
   * - Never override a manual rejection
   */
  upsertWithConflict(data: NewMatch): void {
    this.db
      .insert(matches)
      .values(data)
      .onConflictDoUpdate({
        target: [
          matches.sourceType,
          matches.sourceId,
          matches.targetType,
          matches.targetId,
        ],
        set: {
          score: sql`excluded.score`,
          confidence: sql`excluded.confidence`,
          method: sql`excluded.method`,
          targetMeta: sql`excluded.target_meta`,
          status: sql`CASE WHEN ${matches.status} = 'confirmed' THEN 'confirmed' WHEN ${matches.status} = 'rejected' AND ${matches.method} = 'manual' THEN 'rejected' ELSE excluded.status END`,
          parkedAt: sql`excluded.parked_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .run();
  }

  updateStatus(id: string, status: string, extra?: Partial<Match>): void {
    this.db
      .update(matches)
      .set({
        status: status as Match["status"],
        ...extra,
        updatedAt: Date.now(),
      })
      .where(eq(matches.id, id))
      .run();
  }

  getStats(
    sourceType: string,
    targetType: string,
  ): { pending: number; confirmed: number; rejected: number } {
    const rows = this.db
      .select({
        pending: sql<number>`SUM(CASE WHEN ${matches.status} = 'pending' THEN 1 ELSE 0 END)`,
        confirmed: sql<number>`SUM(CASE WHEN ${matches.status} = 'confirmed' THEN 1 ELSE 0 END)`,
        rejected: sql<number>`SUM(CASE WHEN ${matches.status} = 'rejected' THEN 1 ELSE 0 END)`,
      })
      .from(matches)
      .where(
        and(
          eq(matches.sourceType, sourceType as Match["sourceType"]),
          eq(matches.targetType, targetType as Match["targetType"]),
        ),
      )
      .all();

    const row = rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      confirmed: Number(row?.confirmed ?? 0),
      rejected: Number(row?.rejected ?? 0),
    };
  }
}
