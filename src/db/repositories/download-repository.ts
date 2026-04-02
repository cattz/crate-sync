import { eq, and, sql } from "drizzle-orm";
import { downloads, type Download } from "../schema.js";
import type { IDownloadRepository } from "../../ports/repositories.js";
import type { getDb } from "../client.js";

type Db = ReturnType<typeof getDb>;

export class DrizzleDownloadRepository implements IDownloadRepository {
  constructor(private db: Db) {}

  findById(id: string): Download | null {
    return (
      this.db
        .select()
        .from(downloads)
        .where(eq(downloads.id, id))
        .get() ?? null
    );
  }

  findByTrackId(trackId: string): Download | null {
    return (
      this.db
        .select()
        .from(downloads)
        .where(eq(downloads.trackId, trackId))
        .get() ?? null
    );
  }

  findByStatus(status: string): Download[] {
    return this.db
      .select()
      .from(downloads)
      .where(eq(downloads.status, status as Download["status"]))
      .all();
  }

  findCompletedWithFilePath(): Array<{ trackId: string; filePath: string }> {
    return this.db
      .select({
        trackId: downloads.trackId,
        filePath: downloads.filePath,
      })
      .from(downloads)
      .where(
        and(
          eq(downloads.status, "done"),
          sql`${downloads.filePath} IS NOT NULL`,
        ),
      )
      .all()
      .filter((d): d is { trackId: string; filePath: string } => d.filePath != null);
  }

  insert(data: {
    trackId: string;
    playlistId?: string | null;
    status: string;
    origin?: string;
    createdAt?: number;
  }): Download {
    return this.db
      .insert(downloads)
      .values({
        trackId: data.trackId,
        playlistId: data.playlistId,
        status: data.status as Download["status"],
        origin: (data.origin ?? "not_found") as Download["origin"],
        createdAt: data.createdAt ?? Date.now(),
      })
      .returning()
      .get();
  }

  updateFields(id: string, fields: Partial<Download>): void {
    this.db
      .update(downloads)
      .set(fields)
      .where(eq(downloads.id, id))
      .run();
  }
}
