import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

/**
 * Applies the generated migrations to whatever DATABASE_URL points at.
 *
 * drizzle-kit's own migrate command speaks to Neon over HTTP. This runs the
 * same SQL over a plain connection, which is what a local Postgres container
 * needs. Same statements, same order.
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

const client = new pg.Client({
  connectionString: url,
  // Local containers have no certificate; hosted Postgres does.
  ssl: url.includes("localhost") || url.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

await client.connect();

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
      await client.query(trimmed);
    } catch (error) {
      // "already exists" means this migration has been applied before, which
      // is not a failure worth shouting about.
      if (error.code === "42P07" || error.code === "42710") continue;

      failures++;
      console.error(`  FAILED: ${trimmed.slice(0, 100).replace(/\s+/g, " ")}`);
      console.error(`    ${error.message}`);
    }
  }
}

const { rows } = await client.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
);
const { rows: ext } = await client.query(
  `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
);

await client.end();

console.log(`\ntables: ${rows.map((r) => r.table_name).join(", ")}`);
console.log(`pgvector: ${ext.length > 0}`);

if (failures > 0) {
  console.error(`\n${failures} statement(s) failed`);
  process.exit(1);
}
console.log("migration applied");
