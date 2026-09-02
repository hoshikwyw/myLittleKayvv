import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { neon } from "@neondatabase/serverless";

/**
 * Applies the generated migrations to whatever DATABASE_URL points at.
 *
 * Two transports, chosen the same way `src/db/index.ts` chooses its driver:
 *
 * - **Neon** over HTTPS. Not merely a preference — plenty of networks block
 *   outbound 5432, and on one of those every Postgres client in the world
 *   times out while the application itself works perfectly, because it speaks
 *   HTTP. A migrator that cannot reach a database the app can reach is a
 *   migrator that will be blamed for the wrong thing.
 * - **Anything else** over a normal connection, which is what a local
 *   container needs.
 *
 * Same statements, same order, either way.
 */

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, value] = match;
      if (!process.env[key]) process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local is fine when DATABASE_URL comes from the environment.
  }
}

loadEnvLocal();

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No database URL. Pass one as an argument or set DATABASE_URL.");
  process.exit(1);
}

/** Kept in step with `isNeonUrl` in src/db/index.ts. */
const isNeon = /(^|@|\.)neon\.(tech|build)/i.test(url);

/**
 * One shape for both: run a statement, close when done.
 *
 * The HTTP driver has no connection to open or close, so those are no-ops —
 * which is the whole reason it works where a socket does not.
 */
async function connect() {
  if (isNeon) {
    const sql = neon(url);
    return {
      kind: "neon (https)",
      // The HTTP driver hands back a plain array of rows where node-postgres
      // returns a result object. Normalised here so everything downstream can
      // read `.rows` without caring which transport it came from.
      query: async (text) => {
        const result = await sql.query(text);
        return { rows: Array.isArray(result) ? result : (result?.rows ?? []) };
      },
      end: async () => {},
    };
  }

  const client = new pg.Client({
    connectionString: url,
    // Local containers have no certificate; hosted Postgres does.
    ssl:
      url.includes("localhost") || url.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
  });

  await client.connect();

  return {
    kind: "postgres (tcp)",
    query: (text) => client.query(text),
    end: () => client.end(),
  };
}

const db = await connect();
console.log(`connecting over ${db.kind}\n`);

let failures = 0;

for (const file of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
  const statements = readFileSync(`drizzle/${file}`, "utf8").split(
    "--> statement-breakpoint",
  );
  console.log(`${file}: ${statements.length} statements`);

  for (const statement of statements) {
    const trimmed = statement.trim();
    if (!trimmed) continue;

    try {
      await db.query(trimmed);
    } catch (error) {
      /*
       * Already applied is not a failure.
       *
       * Matched on message as well as code: the HTTP driver does not always
       * surface a `code`, and a migration re-run has to be quiet either way or
       * every deploy looks like it went wrong.
       */
      const already =
        error.code === "42P07" ||
        error.code === "42710" ||
        error.code === "42701" ||
        error.code === "42703" ||
        /already exists|does not exist/i.test(error.message ?? "");

      if (already) continue;

      failures++;
      console.error(`  FAILED: ${trimmed.slice(0, 100).replace(/\s+/g, " ")}`);
      console.error(`    ${error.message}`);
    }
  }
}

const tables = await db.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
);
const ext = await db.query(
  `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
);

/**
 * What is in there, said out loud.
 *
 * The schema is the only thing these migrations create — there is no seed
 * data anywhere in this project — and printing the counts is how that stops
 * being a claim and becomes something you can see.
 */
const counts = await db.query(
  `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname`,
);

await db.end();

console.log(`\ntables: ${tables.rows.map((r) => r.table_name).join(", ")}`);
console.log(`pgvector: ${ext.rows.length > 0}`);
console.log(
  `rows: ${
    counts.rows.map((r) => `${r.relname}=${r.n_live_tup}`).join("  ") || "none"
  }`,
);

if (failures > 0) {
  console.error(`\n${failures} statement(s) failed`);
  process.exit(1);
}
console.log("migration applied");
