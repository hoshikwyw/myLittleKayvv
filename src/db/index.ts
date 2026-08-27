import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Database client.
 *
 * Two drivers, chosen by what the connection string points at:
 *
 * - **Neon** uses their HTTP driver: one round trip per query and no pool to
 *   manage, which is what a serverless function that may be frozen mid-request
 *   needs. The trade-off is no interactive transactions.
 * - **Anything else** uses node-postgres, so the app runs against a plain
 *   Postgres in Docker with no Neon account. Same Drizzle, same schema, same
 *   SQL — only the transport differs.
 *
 * Deliberately lazy: importing this must not throw when DATABASE_URL is absent,
 * so pages that merely probe configuration keep working.
 */

/**
 * One surface type rather than a union of both drivers. A union makes every
 * query builder method resolve to an intersection of two signatures, which
 * breaks `.returning()` at each call site for no benefit — the two clients are
 * the same Drizzle API over the same schema, differing only in transport.
 */
type Database = ReturnType<typeof createNeonClient>;

function isNeonUrl(url: string): boolean {
  return /(^|@|\.)neon\.(tech|build)/i.test(url);
}

function createNeonClient(url: string) {
  return drizzleNeon(neon(url), { schema, casing: "snake_case" });
}

function createPostgresClient(url: string) {
  const isLocal = /localhost|127\.0\.0\.1|\bhost\.docker\.internal\b/.test(url);

  return drizzlePostgres(
    new Pool({
      connectionString: url,
      // A local container has no certificate to verify.
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 5,
    }),
    { schema, casing: "snake_case" },
  );
}

let client: Database | undefined;

export function getDb(): Database {
  if (!client) {
    const url = env.databaseUrl;
    client = isNeonUrl(url)
      ? createNeonClient(url)
      : (createPostgresClient(url) as unknown as Database);
  }
  return client;
}

/**
 * Test-only escape hatch, mirroring `setProvider` in the LLM layer, and the
 * way integration tests point the app at a throwaway database.
 */
export function setDb(next: Database | undefined) {
  client = next;
}

export { schema };
export * from "./schema";
