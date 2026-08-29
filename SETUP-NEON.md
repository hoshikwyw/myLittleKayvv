# Setting up Neon

Kayv stores everything it remembers in Postgres — people, dates, plans,
conversations, and the vectors behind semantic recall. In production that
database is [Neon](https://neon.com): serverless Postgres with a free tier,
no card required.

Locally you can use Docker instead (see [the bottom of this
page](#keeping-a-local-database-too)). This guide is for the hosted one.

Takes about five minutes.

---

## 1. Create the project

1. Go to **[neon.com](https://neon.com)** and sign up. Signing in with GitHub is
   quickest, and no payment details are asked for.
2. It will prompt you to create your first project:

   | Field | Value |
   |---|---|
   | **Project name** | `kayv` |
   | **Postgres version** | leave the default |
   | **Region** | the one nearest you — `AWS ap-southeast-1 (Singapore)` is closest to Yangon |

3. Click **Create project**.

You will land on the project dashboard, with a branch called `production` and a
database called `neondb` already made for you.

**Region matters more than it looks.** Every query from a Vercel function
crosses the network to this region, so a distant one adds latency to every
memory lookup the assistant does mid-conversation.

---

## 2. Copy the connection string

1. Click **Connect** on the project dashboard.
2. The "Connect to your database" modal opens.
3. **Leave the "Connection pooling" toggle on.** This is the important part.
4. Copy the string.

It must contain **`-pooler`** in the hostname:

```
postgresql://neondb_owner:PASSWORD@ep-something-a1b2c3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
                                                     ^^^^^^^
```

### Why pooled, not direct

A serverless function opens a database connection **per invocation** and cannot
keep one alive between requests. The direct endpoint — no `-pooler`, port 5432 —
runs out of connections under even light use, and the failure looks like random
intermittent errors rather than anything obviously connection-related.

This is the single most common mistake when putting Postgres behind Vercel.

---

## 3. Put it in `.env.local`

Open `.env.local` and replace the `DATABASE_URL` line:

```diff
- DATABASE_URL=postgresql://postgres:devpass@localhost:55432/kayv
+ DATABASE_URL=postgresql://neondb_owner:...-pooler....neon.tech/neondb?sslmode=require
```

`.env.local` is gitignored, so this never reaches the repository. If the string
is ever exposed, reset the password from **Neon → Roles**.

**No code change is needed.** The client picks its driver from the hostname:
Neon's HTTP driver when it sees a Neon URL, plain node-postgres otherwise. See
`src/db/index.ts`.

---

## 4. Run the migrations

```bash
npx tsx scripts/migrate.mjs
```

It reads `DATABASE_URL` from `.env.local`. Expected output:

```
0000_sleepy_snowbird.sql: 34 statements
0001_lush_zzzax.sql: 1 statements
0002_little_lester.sql: 4 statements
0003_early_vanisher.sql: 1 statements

tables: conversations, important_dates, memories, messages, notifications, people, plans
pgvector: true
migration applied
```

**All four matter**, and skipping any of them fails quietly rather than loudly:

| Migration | Without it |
|---|---|
| `0000` | no tables at all |
| `0001` | concurrent tool calls create duplicate people — one row per call |
| `0002` | repeating plans cannot be stored |
| `0003` | plans keep a dead `notified_at` column the sweep no longer reads |

### Why not `npm run db:migrate`?

That runs `drizzle-kit migrate`, which speaks to Neon over its HTTP driver.
`scripts/migrate.mjs` runs the same SQL over a plain connection, which works
against Neon *and* a local Postgres — so one command covers both.

---

## 5. Check it landed

```bash
npm run dev
curl -H "Authorization: Bearer dev-only-change-me" http://localhost:5173/api/health
```

Look for:

```json
{
  "ok": true,
  "database": { "migrated": true, "pgvector": true }
}
```

`migrated: true` means all seven tables exist. `pgvector: true` means semantic
recall will work — without it, storing a memory succeeds but recalling one by
meaning silently returns nothing.

Then open <http://localhost:5173> and tell it something:

> My sister Nandar was born on 30 August 1998 and is allergic to peanuts.

Cards should appear confirming what it stored, and the **Memory** panel should
show her.

---

## 6. Add it to Vercel

Vercel does **not** read `.env.local`. Every variable has to be added in the
dashboard under **Settings → Environment Variables**, including
`DATABASE_URL`.

Migrations are run from your machine against the same database, not by Vercel
at build time — so step 4 covers production too.

See [DEPLOY.md](DEPLOY.md) for the rest of the deployment.

---

## Keeping a local database too

Docker gives you a throwaway Postgres with pgvector, which is what the
integration tests use:

```bash
npm run db:local          # start Postgres 17 + pgvector on :55432
npm run db:migrate:local  # apply the same migrations
npm run db:local:stop     # remove it
```

**`npm test` truncates every table it touches.** Once Neon holds real data,
never point the test suite at it. Two ways to stay safe:

- Keep `DATABASE_URL` on Docker for development and only put the Neon string in
  Vercel, or
- Point `DATABASE_URL` at Neon and set `TEST_DATABASE_URL` to the Docker one —
  the suite uses that when present.

---

## If something goes wrong

| Symptom | Cause |
|---|---|
| `CREATE EXTENSION ... vector` fails | Rare, but means the region lacks pgvector. Create the project in a different region. |
| `too many connections` | You used the direct string. Get the pooled one — it has `-pooler` in the hostname. |
| `password authentication failed` | The string was truncated on copy, or the role password was reset. Copy it again from **Connect**. |
| `"migrated": false` | The migrations ran against a different database than the app is using. Check `DATABASE_URL` is the same in both places. |
| `"pgvector": false` | Migration `0000` did not complete. Re-run `npx tsx scripts/migrate.mjs`. |
| Connection hangs, no error | Neon suspends idle computes on the free tier; the first query after a pause takes a few seconds to wake it. |

### Free tier limits

Generous for one person: 0.5 GB storage and one always-available branch. Kayv's
whole dataset is text and 768-dimensional vectors — thousands of memories are
measured in megabytes.

The compute **suspends after inactivity** and wakes on the next query. That
adds a few seconds to the first request after a quiet spell, including the
daily reminder sweep, which is harmless for something that runs once a day.
