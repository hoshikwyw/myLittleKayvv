import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { configured, env } from "@/lib/env";
import { configuredChannels } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Readiness probe.
 *
 * Public callers get liveness only. The detailed report — which subsystems are
 * wired up, whether the schema actually landed — is behind the cron secret,
 * because on a public URL an unauthenticated inventory of your integrations is
 * free reconnaissance. It reports booleans and table names, never a credential.
 */

const EXPECTED_TABLES = [
  "conversations",
  "important_dates",
  "memories",
  "messages",
  "notifications",
  "people",
  "plans",
];

function isAuthorised(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const expected = `Bearer ${env.cronSecret}`;
  if (header.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

async function checkDatabase() {
  if (!configured.database()) {
    return { connected: false, reason: "DATABASE_URL is not set" };
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

    const present = tables.rows.map((r) => r.table_name);
    const missing = EXPECTED_TABLES.filter((t) => !present.includes(t));

    return {
      connected: true,
      pgvector: extensions.rows.length > 0,
      tables: present,
      // The most common broken deploy: database reachable, migration never run.
      missingTables: missing,
      migrated: missing.length === 0,
    };
  } catch (error) {
    return {
      connected: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) {
    // Liveness only. Enough for an uptime check, nothing for a stranger.
    return Response.json({ ok: true });
  }

  const database = await checkDatabase();

  const subsystems = {
    llm: configured.llm(),
    database: database.connected,
    migrated: "migrated" in database ? database.migrated : false,
    pgvector: "pgvector" in database ? database.pgvector : false,
    maps: configured.maps(),
    search: configured.search(),
    calendar: configured.calendar(),
    telegram: configured.telegram(),
    email: configured.email(),
  };

  // The assistant is useful without Maps or Search. It is not useful without a
  // model, and reminders do not exist without a database and a way to deliver.
  const essential =
    subsystems.llm && subsystems.database && subsystems.migrated;
  const remindersReady = essential && configuredChannels().length > 0;

  return Response.json({
    ok: essential,
    assistant: env.assistantName,
    timezone: env.timezone,
    model: env.geminiModel,
    remindersReady,
    notificationChannels: configuredChannels(),
    subsystems,
    database,
  });
}
