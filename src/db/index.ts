import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Database client.
 *
 * Uses Neon's HTTP driver: one round trip per query, no connection pool to
 * manage, which is what you want in a serverless function that may be frozen
 * mid-request. The trade-off is no interactive transactions — if we ever need
 * one, switch that call site to the WebSocket driver rather than changing this.
 *
 * Deliberately lazy. Importing this module must not throw when DATABASE_URL is
 * absent, so pages that merely probe configuration keep working.
 */

type Database = ReturnType<typeof createClient>;

function createClient() {
  const sql = neon(env.databaseUrl);
  return drizzle(sql, { schema, casing: "snake_case" });
}

let client: Database | undefined;

export function getDb(): Database {
  client ??= createClient();
  return client;
}

export { schema };
export * from "./schema";
