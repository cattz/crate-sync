import { eq, and } from "drizzle-orm";
import { rejections, type Rejection } from "../schema.js";
import type { IRejectionRepository } from "../../ports/repositories.js";
import type { getDb } from "../client.js";

type Db = ReturnType<typeof getDb>;

export class DrizzleRejectionRepository implements IRejectionRepository {
  constructor(private db: Db) {}

  findFileKeysByTrackAndContext(trackId: string, context: string): Set<string> {
    const rows = this.db
      .select({ fileKey: rejections.fileKey })
      .from(rejections)
      .where(
        and(
          eq(rejections.trackId, trackId),
          eq(rejections.context, context as Rejection["context"]),
        ),
      )
      .all();

    return new Set(rows.map((r) => r.fileKey));
  }

  findReason(trackId: string, context: string, fileKey: string): string | null {
    const row = this.db
      .select({ reason: rejections.reason })
      .from(rejections)
      .where(
        and(
          eq(rejections.trackId, trackId),
          eq(rejections.context, context as Rejection["context"]),
          eq(rejections.fileKey, fileKey),
        ),
      )
      .get();

    return row?.reason ?? null;
  }

  insert(data: {
    trackId: string;
    context: string;
    fileKey: string;
    reason?: string | null;
  }): void {
    try {
      this.db
        .insert(rejections)
        .values({
          trackId: data.trackId,
          context: data.context as Rejection["context"],
          fileKey: data.fileKey,
          reason: data.reason,
        })
        .run();
    } catch {
      // Ignore unique constraint violation (idempotent insert)
    }
  }
}
