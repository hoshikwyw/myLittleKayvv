import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { EMBEDDING_DIMENSIONS, memories, people, type Memory } from "@/db/schema";
import { getProvider } from "@/lib/llm";

/**
 * The semantic half of memory.
 *
 * Facts that resist a schema — preferences, moments, offhand remarks — get
 * embedded and recalled by meaning. Anything with a shape (a person, a date)
 * belongs in its own table and is queried exactly; see planning.md.
 */

export type MemoryKind =
  | "fact"
  | "preference"
  | "event"
  | "relationship"
  | "other";

export interface StoreMemoryInput {
  content: string;
  personId?: string;
  kind?: MemoryKind;
  /**
   * False when the assistant inferred this from conversation, true when it was
   * told to remember it outright. Recall trusts the two differently.
   */
  confirmed?: boolean;
  confidence?: number;
  sourceMessageId?: string;
}

/** pgvector wants '[1,2,3]', not a JSON array of strings. */
function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function storeMemory(input: StoreMemoryInput): Promise<Memory> {
  const content = input.content.trim();
  if (!content) throw new Error("Cannot store an empty memory.");

  const db = getDb();

  // Embedding failure must not lose the fact. A memory without a vector is
  // still readable by every exact query; it just will not surface in recall,
  // and can be backfilled later.
  let embedding: number[] | null = null;
  try {
    const [vector] = await getProvider().embed([content], {
      purpose: "document",
      dimensions: EMBEDDING_DIMENSIONS,
    });
    embedding = vector ?? null;
  } catch {
    embedding = null;
  }

  const [created] = await db
    .insert(memories)
    .values({
      content,
      personId: input.personId,
      kind: input.kind ?? "fact",
      confirmed: input.confirmed ?? false,
      confidence: input.confidence,
      sourceMessageId: input.sourceMessageId,
      embedding,
    })
    .returning();

  return created;
}

export interface RecalledMemory {
  id: string;
  content: string;
  kind: string;
  personName: string | null;
  confirmed: boolean;
  /** 0-1, higher is closer. Cosine similarity, not distance. */
  similarity: number;
}

export interface RecallOptions {
  query: string;
  personId?: string;
  limit?: number;
  /** Below this, a result is noise rather than a memory. */
  minSimilarity?: number;
}

/**
 * Semantic search over stored facts.
 *
 * Ordering happens in Postgres via the HNSW index rather than by pulling rows
 * into JavaScript — the whole point of storing the vectors there.
 */
export async function recallMemories({
  query,
  personId,
  limit = 6,
  minSimilarity = 0.35,
}: RecallOptions): Promise<RecalledMemory[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let queryVector: number[];
  try {
    const [vector] = await getProvider().embed([trimmed], {
      purpose: "query",
      dimensions: EMBEDDING_DIMENSIONS,
    });
    queryVector = vector;
  } catch {
    // Without an embedding there is no semantic search to do. Saying nothing is
    // better than returning arbitrary rows and calling them relevant.
    return [];
  }

  const literal = toVectorLiteral(queryVector);
  // `<=>` is cosine distance in pgvector, so similarity is one minus it.
  const similarity = sql<number>`1 - (${memories.embedding} <=> ${literal}::vector)`;

  const rows = await getDb()
    .select({
      id: memories.id,
      content: memories.content,
      kind: memories.kind,
      confirmed: memories.confirmed,
      personName: people.name,
      similarity,
    })
    .from(memories)
    .leftJoin(people, eq(memories.personId, people.id))
    .where(
      and(
        sql`${memories.embedding} IS NOT NULL`,
        personId ? eq(memories.personId, personId) : undefined,
      ),
    )
    .orderBy(sql`${memories.embedding} <=> ${literal}::vector`)
    .limit(limit);

  const hits = rows.filter((row) => row.similarity >= minSimilarity);

  // Recency of use is a signal worth keeping, but it must never delay a reply.
  if (hits.length > 0) {
    void markRecalled(hits.map((h) => h.id));
  }

  return hits;
}

async function markRecalled(ids: string[]): Promise<void> {
  try {
    await getDb()
      .update(memories)
      .set({
        recallCount: sql`${memories.recallCount} + 1`,
        lastRecalledAt: new Date(),
      })
      .where(sql`${memories.id} = ANY(${ids})`);
  } catch {
    // Statistics are not worth failing a recall over.
  }
}

export async function confirmMemory(id: string): Promise<boolean> {
  const updated = await getDb()
    .update(memories)
    .set({ confirmed: true, updatedAt: new Date() })
    .where(eq(memories.id, id))
    .returning({ id: memories.id });
  return updated.length > 0;
}

export async function deleteMemory(id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(memories)
    .where(eq(memories.id, id))
    .returning({ id: memories.id });
  return deleted.length > 0;
}
