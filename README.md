# Kayv

A personal AI assistant with voice and text control, persistent memory of the
people who matter, and proactive reminders that arrive before you forget.

Not a chatbot with a microphone. The memory and the reminder engine are the
product; voice is just the interface.

## What it does

- **Talk to it** — by voice or by text, about anything. It speaks as it
  thinks, and stops the moment you start talking
- **Knows your day** — its own plan list, plus your Google Calendar
- **Finds things** — places on Google Maps, answers on Google Search
- **Remembers people** — birthdays, anniversaries, the details you care about,
  each fact linked back to the message it came from
- **Keeps the thread** — conversations survive a reload
- **Speaks first** — a daily sweep tells you a birthday is coming, via
  Telegram or email. It runs off the database and a cron job, never the model

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4, design tokens, Motion |
| Model | Gemini 2.5 Flash, behind a swappable `LLMProvider` interface |
| Database | Neon Postgres + Drizzle ORM, pgvector for recall |
| Scheduler | Vercel Cron (daily) |
| Notifications | Telegram Bot API, Resend email |
| Hosting | Vercel |

Everything above runs on a free tier.

## Getting started

```bash
cp .env.example .env.local   # then fill in your keys
npm install
npm run dev
```

Open http://localhost:5173 for the assistant. The build-status board, showing
which subsystems are wired up, is at `/status`.

### Database setup

**Locally**, with Docker — no account needed:

```bash
npm run db:local          # Postgres 17 + pgvector in a container on :55432
npm run db:migrate:local  # creates the extension and all seven tables
```

Then set `DATABASE_URL` in `.env.local`:

```
DATABASE_URL=postgresql://postgres:devpass@localhost:55432/kayv
```

`npm run db:local:stop` removes the container when you are done.

**In production**, create a free Postgres at [neon.tech](https://neon.tech), use
its **pooled** connection string, and run `npm run db:migrate`.

The app picks its driver from the URL: Neon's HTTP driver for Neon, plain
node-postgres for anything else. Same schema, same SQL.

Check it landed:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:5173/api/health
```

Look for `"migrated": true` and `"pgvector": true`.

### Keys you'll need

| Variable | Where to get it | Needed for |
|---|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Part 2 onward |
| `DATABASE_URL` | [Neon](https://neon.tech) | Part 1 onward |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | [@BotFather](https://t.me/botfather) | Part 8 |
| `CRON_SECRET` | any long random string, also set in Vercel | Part 8 |
| `GOOGLE_MAPS_API_KEY` | Google Cloud Console — Places API (New) | Part 7 |
| `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` | [Programmable Search](https://programmablesearchengine.google.com) | Part 7 |
| `GOOGLE_OAUTH_*` | Google Cloud OAuth client, calendar.readonly scope | Part 7 |
| `HOME_LOCATION` | `lat,lng` — what "near me" means | Part 7 |

## Layout

```
src/
  app/           routes, API handlers, global styles
  components/    UI, with primitives under ui/
  hooks/         assistant state machine and transport
  lib/
    env.ts       validated environment access
    llm/         model providers behind one interface
    tools/       agent tool definitions and registry
    memory/      structured and semantic memory
    voice/       STT/TTS adapters
  db/            Drizzle schema and client
  types/         shared types
tests/           unit tests for the logic that must not be wrong
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Full suite. Integration tests skip themselves if no database is up |
| `npm run db:local` | Postgres + pgvector in Docker, for development and tests |
| `npm run db:migrate:local` | Apply migrations to the local container |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate migrations from schema |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Browse the database |

## Deploying

See [DEPLOY.md](DEPLOY.md) for the full runbook — database, Telegram bot,
environment variables, and verifying the cron job actually fires.

## Architecture and decisions

See [planning.md](planning.md) for the decision log, risk register, and the
part-by-part build plan.
