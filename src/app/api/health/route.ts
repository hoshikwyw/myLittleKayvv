import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { configured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Health probe. Answers one question honestly: can we reach the database and
 * are the tables actually there? Used to verify a migration landed, and later
 * as a cheap uptime check.
 */
export async function GET() {
  if (!configured.database()) {
    return Response.json(
      { ok: false, database: "unconfigured", detail: "DATABASE_URL is not set" },
      { status: 503 },
    );
  }

  try {
    const db = getDb();

    const tables = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const extensions = await db.execute<{ extname: string }>(sql`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `);

    const tableNames = tables.rows.map((r) => r.table_name);

    return Response.json({
      ok: true,
      database: "connected",
      pgvector: extensions.rows.length > 0,
      tables: tableNames,
      tableCount: tableNames.length,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        database: "error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
