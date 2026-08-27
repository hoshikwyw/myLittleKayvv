import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { setDb } from "@/db";

/**
 * Integration test harness.
 *
 * Runs the real memory code against a real Postgres with pgvector, injected
 * through `setDb`. Neon's HTTP driver only talks to Neon, so tests use
 * node-postgres — same Drizzle, same schema, same emitted SQL. What these
 * cover is the SQL and the logic; the HTTP transport is the part they do not.
 *
 * Start the database with `npm run db:local`.
 */

export function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, value] = match;
      if (!process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Absent is fine — the environment may already carry what is needed.
  }
}

loadEnvLocal();

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:devpass@localhost:55432/kayv";

let pool: Pool | undefined;

export async function connect() {
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema, casing: "snake_case" });

  // The app reaches for getDb() internally; point it at this one.
  setDb(db as unknown as Parameters<typeof setDb>[0]);
  return db;
}

export async function disconnect() {
  setDb(undefined);
  await pool?.end();
  pool = undefined;
}

/** Between tests, so one test's rows cannot explain another's result. */
export async function reset(db: Awaited<ReturnType<typeof connect>>) {
  await db.execute(sql`
    TRUNCATE TABLE
      notifications, memories, messages, conversations,
      important_dates, plans, people
    RESTART IDENTITY CASCADE
  `);
}

/** Whether a live database is reachable; tests skip rather than fail if not. */
export async function isReachable(): Promise<boolean> {
  const probe = new Pool({
    connectionString: TEST_DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}
