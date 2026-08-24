import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs outside Next, so it never sees .env.local. Rather than pull
 * in dotenv for one variable, load it here — small, explicit, no dependency.
 */
function loadEnvLocal() {
  let contents: string;
  try {
    contents = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }

  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
