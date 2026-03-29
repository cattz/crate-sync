import type { LexiconTrack, LexiconTagCategory, LexiconTag } from "../types/lexicon.js";
import type { LexiconConfig } from "../config.js";
import { withRetry } from "../utils/retry.js";

/** Normalize an ID (int or string) to string */
function normalizeId(id: unknown): string {
  return String(id);
}

/** Unwrap Lexicon API responses which may be wrapped in various ways */
function unwrapResponse<T>(body: unknown, key: string): T {
  let current = body;

  // Peel off up to 2 layers of wrapping (e.g. { data: { tracks: [...] } })
  for (let i = 0; i < 2; i++) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    const obj = current as Record<string, unknown>;

    if (key in obj) return obj[key] as T;
    if ("content" in obj && Array.isArray(obj.content)) return obj.content as T;
    if ("data" in obj) { current = obj.data; continue; }
    break;
  }

  return current as T;
}

function normalizeLexiconTrack(raw: Record<string, unknown>): LexiconTrack {
  // Duration: API returns seconds in `duration`, convert to ms
  let durationMs: number | undefined;
  if (raw.duration != null) {
    durationMs = Math.round(Number(raw.duration) * 1000);
  } else if (raw.durationMs != null) {
    durationMs = Number(raw.durationMs);
  } else if (raw.duration_ms != null) {
    durationMs = Number(raw.duration_ms);
  }

  return {
    id: normalizeId(raw.id),
    filePath: String(raw.location ?? raw.filePath ?? raw.file_path ?? ""),
    title: String(raw.title ?? ""),
    artist: String(raw.artist ?? ""),
    album: raw.albumTitle != null ? String(raw.albumTitle) : raw.album != null ? String(raw.album) : undefined,
    durationMs,
  };
}

export class LexiconService {
  private baseUrl: string;

  constructor(private config: LexiconConfig) {
    // Strip trailing slash and append /v1
    this.baseUrl = config.url.replace(/\/+$/, "") + "/v1";
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    return withRetry(async () => {
      const url = `${this.baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "<no body>");
        throw new Error(
          `Lexicon API error: ${response.status} ${response.statusText} — ${body}`,
        );
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as Promise<T>;
    });
  }

  /** Test connection to Lexicon */
  async ping(): Promise<boolean> {
    try {
      await this.request("/tracks?limit=1");
      return true;
    } catch {
      return false;
    }
  }

  /** Get all tracks from the Lexicon library (paginated, max 1000 per page) */
  async getTracks(): Promise<LexiconTrack[]> {
    const PAGE_SIZE = 1000;
    const allTracks: LexiconTrack[] = [];
    let offset = 0;

    while (true) {
      const raw = await this.request<unknown>(
        `/tracks?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      const page = unwrapResponse<Record<string, unknown>[]>(raw, "tracks");
      allTracks.push(...page.map(normalizeLexiconTrack));

      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return allTracks;
  }

  /** Search tracks by artist and/or title (client-side filtering since API has no search endpoint) */
  async searchTracks(query: {
    artist?: string;
    title?: string;
  }): Promise<LexiconTrack[]> {
    const all = await this.getTracks();
    return all.filter((t) => {
      if (query.artist && !t.artist.toLowerCase().includes(query.artist.toLowerCase())) {
        return false;
      }
      if (query.title && !t.title.toLowerCase().includes(query.title.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  /** Get a single track by ID */
  async getTrack(id: string): Promise<LexiconTrack | null> {
    try {
      const raw = await this.request<unknown>(`/track?id=${id}`);
      const track = unwrapResponse<Record<string, unknown>>(raw, "track");
      return normalizeLexiconTrack(track);
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) return null;
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Tags (low-level)
  // -------------------------------------------------------------------------

  /** Get all tag categories and tags */
  async getTags(): Promise<{ categories: LexiconTagCategory[]; tags: LexiconTag[] }> {
    const raw = await this.request<unknown>("/tags");

    // The response shape is { data: { categories: [...], tags: [...] } }
    let source: Record<string, unknown>;
    if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
      source = (raw as Record<string, unknown>).data as Record<string, unknown>;
    } else {
      source = raw as Record<string, unknown>;
    }

    const rawCategories = (source.categories ?? []) as Record<string, unknown>[];
    const rawTags = (source.tags ?? []) as Record<string, unknown>[];

    const categories: LexiconTagCategory[] = rawCategories.map((c) => ({
      id: normalizeId(c.id),
      label: String(c.label ?? ""),
      color: c.color != null ? String(c.color) : undefined,
    }));

    const tags: LexiconTag[] = rawTags.map((t) => ({
      id: normalizeId(t.id),
      categoryId: normalizeId(t.categoryId),
      label: String(t.label ?? ""),
    }));

    return { categories, tags };
  }

  /** Create a tag category. Response is NOT wrapped in data. */
  async createTagCategory(label: string, color: string): Promise<LexiconTagCategory> {
    const raw = await this.request<Record<string, unknown>>("/tag-category", {
      method: "POST",
      body: JSON.stringify({ label, color }),
    });
    return {
      id: normalizeId(raw.id),
      label: String(raw.label ?? ""),
      color: raw.color != null ? String(raw.color) : undefined,
    };
  }

  /** Create a tag. Response is NOT wrapped in data. */
  async createTag(categoryId: string, label: string): Promise<LexiconTag> {
    const raw = await this.request<Record<string, unknown>>("/tag", {
      method: "POST",
      body: JSON.stringify({ categoryId: Number(categoryId), label }),
    });
    return {
      id: normalizeId(raw.id),
      categoryId: normalizeId(raw.categoryId),
      label: String(raw.label ?? ""),
    };
  }

  /** Update tags on a track. tagIds should be string[] (converted to int for API). */
  async updateTrackTags(trackId: string, tagIds: string[]): Promise<void> {
    await this.request("/track", {
      method: "PATCH",
      body: JSON.stringify({
        id: Number(trackId),
        edits: { tags: tagIds.map(Number) },
      }),
    });
  }

  /** Get the current tag IDs for a track */
  async getTrackTags(trackId: string): Promise<string[]> {
    const raw = await this.request<unknown>(`/track?id=${trackId}`);
    const track = unwrapResponse<Record<string, unknown>>(raw, "track");
    const tags = Array.isArray(track.tags) ? track.tags : [];
    return tags.map(normalizeId);
  }

  // -------------------------------------------------------------------------
  // Tags (high-level, category-scoped)
  // -------------------------------------------------------------------------

  /** Find existing category by label or create new one */
  async ensureTagCategory(label: string, color?: string): Promise<LexiconTagCategory> {
    const { categories } = await this.getTags();
    const existing = categories.find((c) => c.label === label);
    if (existing) return existing;
    try {
      return await this.createTagCategory(label, color ?? "#808080");
    } catch (err) {
      if (String(err).includes("already exists")) {
        const { categories: retry } = await this.getTags();
        const found = retry.find((c) => c.label === label);
        if (found) return found;
      }
      throw err;
    }
  }

  /** Find existing tag in category or create new one */
  async ensureTag(categoryId: string, label: string): Promise<LexiconTag> {
    const { tags } = await this.getTags();
    const existing = tags.find((t) => t.categoryId === categoryId && t.label === label);
    if (existing) return existing;
    try {
      return await this.createTag(categoryId, label);
    } catch (err) {
      if (String(err).includes("already exists")) {
        const { tags: retry } = await this.getTags();
        const found = retry.find((t) => t.categoryId === categoryId && t.label === label);
        if (found) return found;
      }
      throw err;
    }
  }

  /** Read only tags belonging to a specific category for a track */
  async getTrackTagsInCategory(trackId: string, categoryId: string): Promise<LexiconTag[]> {
    const trackTagIds = await this.getTrackTags(trackId);
    const { tags } = await this.getTags();
    return tags.filter((t) => trackTagIds.includes(t.id) && t.categoryId === categoryId);
  }

  /**
   * Category-scoped tag replacement: only modifies tags in the target category,
   * preserves all tags from other categories.
   *
   * Algorithm (read-filter-merge-write):
   * 1. Read track's current tags (all categories)
   * 2. Get all tag definitions to know which belong to which category
   * 3. Filter OUT tags belonging to categoryId
   * 4. Add the new tagIds
   * 5. Write full merged set via updateTrackTags()
   */
  async setTrackCategoryTags(trackId: string, categoryId: string, tagIds: string[]): Promise<void> {
    const currentTagIds = await this.getTrackTags(trackId);
    const { tags: allTags } = await this.getTags();

    // Build a set of tag IDs that belong to the target category
    const categoryTagIds = new Set(
      allTags.filter((t) => t.categoryId === categoryId).map((t) => t.id),
    );

    // Keep only tags NOT in the target category
    const otherTags = currentTagIds.filter((id) => !categoryTagIds.has(id));

    // Merge: other categories' tags + new tags for target category
    const merged = [...otherTags, ...tagIds];

    await this.updateTrackTags(trackId, merged);
  }
}
