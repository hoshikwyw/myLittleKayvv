# Working notes for agents

## What this project is

A single-user personal AI assistant: voice + text, persistent memory about
people, and proactive reminders. Read `planning.md` first — it holds the
decision log, the risk register, and the part-by-part build plan.

## Non-negotiable principles

1. **Reminders never depend on the model.** Dates live in Postgres and fire
   from Vercel Cron. An LLM must never be the thing that "remembers" a
   birthday.
2. **Everything external sits behind an interface.** `LLMProvider`,
   `VoiceAdapter`, notification channels. Swapping a vendor should be a new
   file plus a config change, never a refactor.
3. **Two-tier memory.** Structured tables for facts you query exactly
   (people, dates, plans); vectors only for fuzzy conversational recall.
   Never vector-only.
4. **No framework tax.** The agent loop is hand-rolled. Do not introduce
   LangChain or similar — at this size it hides failures more than it helps.
5. **Colour comes from tokens.** Every colour resolves to a token in
   `globals.css`. No raw hex in components.

## Conventions

- Server-only modules (anything importing `@/lib/env`) must never be pulled
  into a `"use client"` component.
- Route handlers stream with SSE, not WebSocket — Vercel functions cannot
  hold a persistent socket open.
- Vercel Hobby caps functions at 30s. Keep agent loops tight and bounded.
- Language: the assistant speaks English; it reads and writes both English
  and Burmese.

## Testing

`npm test` runs the unit suite over the logic that must not be wrong: calendar
and timezone arithmetic, the reminder firing rule, sentence splitting for
streamed speech, Telegram escaping, and the calculator's refusal to evaluate.

Anything involving a date, a reminder decision, or text handed to a speech
engine gets a test. Everything else is covered by types and the build.

## Commit workflow

Work is built in discrete parts. At the end of each part, propose a commit
message in conventional-commits form — do not run `git commit` yourself.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
