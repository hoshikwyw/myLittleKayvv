# Kayv — Personal AI Assistant

> Living planning document. Decisions, risks, and the build plan.

## 1. Product definition

Five subsystems, not one:

1. **Voice I/O** — wake word -> STT -> LLM -> TTS, with barge-in
2. **Agent / tool layer** — LLM calling typed functions (calendar, maps, search, reminders)
3. **Memory** — short-term conversation + long-term structured facts about people
4. **Proactive engine** — scheduler that speaks first (birthdays, anniversaries)
5. **UI / HUD** — visible surface; must make state legible (idle/listening/thinking/speaking)

**Core insight:** subsystems 3 and 4 are the actual product. Voice is the interface,
memory is the soul. Most hobby Jarvis clones build 1+2 and ship a chatbot with a mic.

## 2. Decisions locked

| # | Decision | Choice | Date |
|---|----------|--------|------|
| D1 | Scope | Personal, single user | 2026-08-24 |
| D2 | Platform | Web first; Tauri desktop later for always-on wake word | 2026-08-24 |
| D3 | LLM | Gemini 3.6 Flash (free tier) behind an `LLMProvider` interface | 2026-08-24 |
| D4 | Language | English voice; English + Burmese text | 2026-08-24 |
| D5 | Voice Phase 1 | Browser Web Speech API (free), behind `VoiceAdapter` interface | 2026-08-24 |
| D6 | Memory policy | Auto-extract facts, surface an undoable confirm card | 2026-08-24 |
| D7 | Hosting | Vercel (Hobby) | 2026-08-24 |
| D8 | Language/runtime | TypeScript end-to-end — Next.js, not Python/FastAPI | 2026-08-24 |
| D9 | Notifications | Telegram bot (primary) + email (backup) | 2026-08-24 |
| D10 | UI direction | Modern calm assistant, not Iron Man HUD | 2026-08-24 |

### Why D8 (TypeScript, not Python)

Choosing Vercel forced this. Vercel Hobby cannot run a persistent process, so
APScheduler, WebSocket, and SQLite all die. Python on Vercel is second-class
(cold starts, weaker runtime support). Going all-TypeScript in one Next.js repo
buys one language, one deploy, and $0/month. The cost is Python's nicer AI
ecosystem, which we do not actually need for Gemini plus tool calls.

### Vercel Hobby constraints we designed around

| Limit | Value | Our response |
|---|---|---|
| Cron cadence | once/day, UTC, fires within the hour | Daily 00:00 UTC reminder sweep — sufficient |
| Cron count | 100 per project | Non-issue |
| Function timeout | 30s | Keep agent loops tight and bounded |
| Filesystem | ephemeral | Neon Postgres instead of SQLite |
| Persistent socket | not supported | SSE streaming instead of WebSocket |
| Always-on process | none | Vercel Cron instead of APScheduler |

## 3. Architectural principles

- **One brain, many mouths.** Core agent lives behind the API. Web/desktop/mobile
  are thin clients. Never fork logic per platform.
- **Deterministic where it must be.** Reminders fire from DB + cron, never from
  "the LLM remembering." LLMs forget; cron does not.
- **Two-tier memory.** Structured tables for exact queries + vectors for fuzzy
  recall. Vector-only is the classic mistake.
- **Everything external is an adapter.** LLM, STT, TTS, notification channels.
- **No framework tax.** Hand-rolled tool loop over LangChain at this scale.
- **Colour comes from tokens.** Enables a future "JARVIS mode" skin as a token swap.

## 4. Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gemini free tier trains on our inputs | HIGH — intimate personal data | Keep memory in our DB; send minimal context per turn; upgrade to paid/Vertex if it matters |
| Gemini free quotas cut without notice (happened Dec 2025) | MED | `LLMProvider` interface; keep a fallback provider ready |
| Gemini Live API free-tier availability unconfirmed | MED | Not on the critical path; stitched pipeline instead |
| Burmese TTS quality is poor across all vendors | HIGH | English voice only at launch; Burmese speech is Phase 3, feature-flagged |
| Burmese STT is paid-only (ElevenLabs Scribe, Gladia) | MED | Burmese via text input at launch |
| Vercel 30s function ceiling | MED | Bound tool-loop iterations; stream early |
| API key committed by accident | HIGH | `.env*` gitignored except `.env.example`; secrets only in `.env.local` and Vercel env |

## 5. Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js 16 App Router, React 19, TypeScript | One repo, one deploy |
| Styling | Tailwind CSS 4 + design tokens | Token layer enables theme skins |
| Animation | Motion | Voice orb and state transitions |
| Streaming | SSE (`ReadableStream`) | Vercel cannot hold a WebSocket |
| LLM | `@google/genai`, Gemini 3.6 Flash | 2.5 Flash 404s for newly issued keys |
| Structured memory | Neon Postgres + Drizzle ORM | Serverless-native, free tier |
| Semantic memory | pgvector on the same Neon DB | One database, not two |
| Scheduler | Vercel Cron, daily 00:00 UTC | Free, no server to babysit |
| Notifications | Telegram Bot API + Resend | Both free; Telegram primary |
| Tools | Google Maps Places, Custom Search, Calendar | All have free tiers |
| Desktop (later) | Tauri | ~10MB shell, enables always-on wake word |

**Running cost: $0/month.**

## 6. Build plan

Each part is self-contained, independently verifiable, and ends with a commit.

| Part | Deliverable | Verified by | Status |
|------|-------------|-------------|--------|
| 0 | Scaffold: Next.js + TS + Tailwind, tokens, env, structure | `npm run dev` shows the status board | **done** |
| 1 | DB schema + Drizzle: people, important_dates, plans, memories, conversations | Migration runs against Neon | **schema done, awaiting `DATABASE_URL`** |
| 2 | `LLMProvider` interface + Gemini adapter + streaming chat route | Text chat works end to end | **done** |
| 3 | Tool registry + agent loop (tool calling, multi-turn) | A question that needs a tool gets answered | **done** |
| 4 | Memory tools + confirm-card UX | "her birthday is March 3" -> card -> DB row | **next** |
| 5 | Assistant shell: chat panel, voice orb, state machine | Looks like a real assistant | todo |
| 6 | `VoiceAdapter` + browser STT/TTS, barge-in | You talk, it talks back | todo |
| 7 | Google Maps Places, Search, Calendar tools | "Find coffee near me" returns real places | todo |
| 8 | Vercel Cron + Telegram + email fallback | A test date fires a real Telegram message | todo |
| 9 | Deploy to Vercel, env wiring, cron verification | Live URL, reminders firing from the cloud | todo |

Parts 0-4 are the spine. Shipping only those would already be useful.

## 7. Schema design notes (Part 1)

Seven tables. The shape encodes the architecture, so the reasoning matters:

**`important_dates` stores month/day/year as separate integers, not a timestamp.**
A birthday is a calendar recurrence, not an instant. The moment a UTC cron job
compares timestamps you inherit timezone drift and leap-year edge cases. Integer
parts also let `year` be null, which is the common case — you know the day, not
the year.

**`last_notified_on` lives on the row, not in a queue.** Vercel Cron guarantees
timing only within the hour and can retry. Recording the date we last notified
makes the sweep idempotent for free.

**`remind_days_before` is an integer array (`{7,1,0}`).** Lead time is per-date,
not global — a wedding anniversary deserves more warning than a colleague's
birthday.

**`memories.confirmed` implements decision D6 directly.** Auto-extracted facts
land unconfirmed and are recalled with lower trust; the UI card flips the flag.
`source_message_id` keeps the receipt so you can always see where a fact came
from.

**Embeddings are 768-dimensional.** Gemini's embedding model supports truncation
to 768 and pgvector's HNSW index caps at 2000 dimensions. Indexed with
`vector_cosine_ops`, the right default for text.

**`plans.external_id` is uniquely indexed.** Re-syncing Google Calendar must
update rows rather than duplicate them.

**No `user_id` anywhere.** Decision D1 is single-user. Adding the column later is
a migration; carrying it now is dead weight in every query.

**Neon HTTP driver, not WebSocket.** One round trip per query, no pool to manage
in a function that may be frozen mid-request. The cost is no interactive
transactions — if a call site ever needs one, it switches drivers locally rather
than changing the shared client.

## 8. Agent loop notes (Part 3)

**Hand-rolled, one readable function.** Ask the model, run the tools it asked
for, hand results back, repeat. A framework would bury exactly what goes wrong:
where the turn history came from, why a tool ran twice, what happened when one
failed.

**Two hard stops.** `maxIterations` (6) catches a model that keeps calling the
same tool forever; `budgetMs` (25s) stops short of Vercel's 30s kill so the user
gets a sentence instead of a dead connection. Both exits say something rather
than going quiet.

**Tool failures are values, not exceptions.** A thrown error would abort the
turn. Returning the failure to the model lets it explain itself or try
something else — verified: asked to divide by zero, it answered "division by
zero is undefined" rather than erroring out.

**`tool_start` for the whole batch fires before any tool runs**, so the UI shows
every spinner at once instead of revealing work after it finished.

**Zod schemas are the single source of truth** — they generate the JSON Schema
the model sees and validate the arguments it sends back. No second place to
drift. `$schema` is stripped because Gemini rejects it.

**The calculator parses; it never evaluates.** Input reaching it originates from
whatever text the model read, so `eval` would be a remote execution hole wearing
a calculator costume. Hand-written recursive descent instead, verified to reject
`alert(1)`, `process.exit()`, and `$(whoami)`.

**Thought signatures (Gemini 3).** Gemini 3 rejects a follow-up whose function
call has lost its `thoughtSignature`, and the SDK's `functionCalls` accessor
drops it. The adapter reads raw parts instead and carries the value through an
opaque `providerState` field on `ToolCallRequest` — vendor-neutral in the
interface, understood only by the adapter that produced it.

## 9. Open questions

- [ ] Exact memory write policy: which fact types auto-save vs. need confirmation
- [ ] How far back conversation context is replayed into each turn (cost vs. continuity)
- [ ] Whether Burmese TTS is worth paying for once the rest works
