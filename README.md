# Kayv

A personal AI assistant with voice and text control, persistent memory of the
people who matter, and proactive reminders that arrive before you forget.

Not a chatbot with a microphone. The memory and the reminder engine are the
product; voice is just the interface.

## What it does

- **Talk to it** — by voice or by text, about anything
- **Knows your day** — plans, schedules, what's next
- **Finds things** — places on Google Maps, answers on Google Search
- **Remembers people** — birthdays, anniversaries, the details you care about
- **Speaks first** — tells you a birthday is coming, via Telegram or email

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

Open http://localhost:5173 — you'll see the build-status board showing which
subsystems are wired up.

### Database setup

Create a free Postgres at [neon.tech](https://neon.tech), copy the connection
string into `DATABASE_URL` in `.env.local`, then:

```bash
npm run db:migrate    # creates the pgvector extension and all seven tables
curl http://localhost:5173/api/health
```

A healthy response lists the tables and reports `"pgvector": true`.

### Keys you'll need

| Variable | Where to get it | Needed for |
|---|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Part 2 onward |
| `DATABASE_URL` | [Neon](https://neon.tech) | Part 1 onward |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/botfather) | Part 8 |
| `GOOGLE_MAPS_API_KEY` | Google Cloud Console | Part 7 |

## Layout

```
src/
  app/           routes, API handlers, global styles
  components/    UI, with primitives under ui/
  lib/
    env.ts       validated environment access
    llm/         model providers behind one interface
    tools/       agent tool definitions and registry
    memory/      structured and semantic memory
    voice/       STT/TTS adapters
  db/            Drizzle schema and client
  types/         shared types
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate migrations from schema |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Browse the database |

## Architecture and decisions

See [planning.md](planning.md) for the decision log, risk register, and the
part-by-part build plan.
