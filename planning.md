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
| 1 | DB schema + Drizzle: people, important_dates, plans, memories, conversations | Migration runs against Neon | **done, verified** |
| 2 | `LLMProvider` interface + Gemini adapter + streaming chat route | Text chat works end to end | **done** |
| 3 | Tool registry + agent loop (tool calling, multi-turn) | A question that needs a tool gets answered | **done** |
| 4 | Memory tools + confirm-card UX | "her birthday is March 3" -> card -> DB row | **done, verified** |
| 5 | Assistant shell: conversation, voice orb, state machine | Looks like a real assistant | **done** |
| 6 | `VoiceAdapter` + browser STT/TTS, barge-in | You talk, it talks back | **done** |
| 7 | Maps, Search, Calendar, and local plans | "Find coffee near me" returns real places | **built, awaiting API keys** |
| 8 | Vercel Cron + Telegram + email fallback | A test date fires a real Telegram message | **sweep verified; delivery needs a bot token** |
| 9 | Deploy to Vercel, env wiring, cron verification | Live URL, reminders firing from the cloud | **prepared — deploy needs your accounts** |
| 10 | Conversation persistence and fact provenance | Reload keeps the thread; memories cite their source | **done, verified** |

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

## 9. Memory notes (Part 4)

**Writes happen first, undo second.** Decision D6 in practice: a fact is saved
as it is heard, then shown as a card with a way to take it back. Asking
permission mid-conversation would make the assistant tiresome, and a missed fact
costs the memory entirely while a wrong one costs a single click.

**Undo is genuinely destructive.** A card that merely hid the row would leave
the assistant still believing something the user explicitly rejected.

**The write log is per-request, not module scope.** A module-level array is
shared across concurrent requests hitting the same warm serverless instance, and
one turn's undo card would show another turn's writes.

**Person resolution is the failure mode that quietly ruins a memory system.**
"Nandar", "Nan", and "my sister" must all reach one row, or the assistant
accumulates duplicate people and remembers each of them half. Name, nickname,
and aliases are all matched case-insensitively; an unambiguous prefix match is
the fallback, and two candidates means asking rather than guessing.

**Updates never blank out a stored value.** The model volunteering less detail
this time must not erase what it told us last time.

**Embedding failure does not lose the fact.** A memory without a vector is still
readable by every exact query — it just will not surface in semantic recall, and
can be backfilled later. Losing the content instead would be unforgivable.

**Vector search happens in Postgres.** Ordering by `<=>` against the HNSW index,
not by pulling rows into JavaScript, which is the entire reason the vectors live
there.

**Memory tools are only registered when a database exists**, and the system
prompt is told when memory is offline. Without that second half the model
cheerfully answers "I'll remember that" while nothing is stored — verified, and
now fixed.

**Leap birthdays are observed on 1 March.** Someone born on 29 February would
otherwise be skipped three years in four.

## 10. Shell notes (Part 5)

**State is explicit, never inferred.** The UI reads one `AssistantState` rather
than working out what is happening from whether some other field is empty. This
matters the moment voice arrives: "listening" and "thinking" look nothing alike
to a person, and a UI deriving them from side effects gets them wrong.

`idle → thinking → speaking → idle`, with `error` reachable from either working
state and `listening` driven only by the microphone in Part 6.

**The transition to "speaking" happens on the first token**, not at the end of
the stream. That is the moment it stops thinking and starts answering, and the
orb should change there.

**Each state has a distinct motion, not just a distinct colour.** Colour alone
fails for the roughly 8% of men with colour vision deficiency, and fails again
on a phone in sunlight. Idle breathes slowly, listening ripples outward,
thinking turns a ring that never progresses, speaking pulses quickly, error goes
still. The state is also written in words in an `aria-live` region, because an
animation on its own is not an interface.

**`prefers-reduced-motion` is honoured in JavaScript too.** The CSS override in
`globals.css` cannot reach Motion's animations, so the orb checks
`useReducedMotion` and holds still.

**The orb shrinks into the header rather than disappearing** once a conversation
starts, so the state indicator never moves out from under the eye watching it.

**Routes moved:** the assistant is now `/`, and the developer build board is
`/status`. The product should be what opens.

## 11. Voice notes (Part 6)

**Barge-in is the feature.** If the assistant is talking and you start talking,
it stops immediately. An assistant that talks over you is worse than one that
cannot talk at all. Tapping the microphone cancels speech before recognition
even starts.

**It speaks while it streams.** Waiting for a full reply before saying a word
throws away the entire latency budget, so text is buffered only as far as the
next sentence boundary and each finished sentence is queued. The splitter
refuses to break on a terminator sitting at the end of the buffer, because "3."
may still be growing into "3.5" — verified against a simulated token stream
where digits and dates land across chunk boundaries.

**Utterances are serialised through a promise queue**, so sentences never
overlap, and one failed utterance cannot poison the rest.

**Burmese is read, not spoken.** Decision D4 made concrete: no browser engine
can pronounce Burmese, and handing it to an English voice produces noise, so
replies containing Burmese script are displayed and skipped by synthesis.

**Capabilities are reported honestly.** Firefox has no speech recognition at
all; rather than failing when someone taps the microphone, the button is not
offered. Detection goes through `useSyncExternalStore` with a server snapshot,
which is the sanctioned way to have a value differ between server and client
without a hydration mismatch or a `setState` in an effect.

**`abort()` rather than `stop()`** when the user stops listening: `stop()` waits
to deliver one more result, which is not what tapping "stop" asks for.

**Speech is cancelled on unmount.** `speechSynthesis` outlives the React tree,
so leaving the page mid-sentence would otherwise leave a voice talking to an
empty room.

### Not verifiable from a terminal

Microphone capture and speech synthesis need a real browser with real hardware.
The sentence splitter, language detection, and capability reporting are unit
tested; the actual listening and speaking have to be tried in Chrome or Edge.

## 12. External tools notes (Part 7)

**Every integration is registered only once its credentials exist**, and the
system prompt is told what is missing. Handing the model a tool that always
fails teaches it to stop reaching for it; leaving it uninformed makes it answer
from memory as though it had checked. Verified: asked to find a coffee shop with
no keys set, it says it cannot look up places or search, and calls nothing.

**Places uses a tight field mask.** The mask is mandatory and it sets the
billing tier directly — requesting every field is the standard way to turn a
free tier into a bill. We ask only for what gets shown.

**`openNow` stays undefined when unknown.** "Closed" and "we do not know" are
different answers and must never collapse into the same one.

**Web search names its real failure.** The Custom Search free tier is 100
queries a day, and quota exhaustion returns a sentence saying so rather than a
raw 429.

**Calendar uses a stored refresh token, not a consent flow.** Single-user
(decision D1), so building a consent screen, redirect handler, and token store
for an audience of one is not worth it. Access tokens are cached with a minute
of headroom, and a 401 drops the cache rather than replaying a dead token.
`singleEvents=true` expands recurrences, otherwise a weekly standup comes back
as one rule rather than the meeting that is actually next.

**Calendar is read-only, and the tool description says so**, so the assistant
declines to create events rather than claiming it did.

**Plans are separate from the calendar.** Since the calendar cannot be written
to, anything the user asks to be written down goes in our own `plans` table, and
the undo card covers it exactly as it covers a stored fact.

**Wall-clock times are converted through the owner's timezone**, not the
server's. "Meet at 3pm" means 3pm where they are; getting it wrong shifts every
appointment by the offset — six and a half hours in Yangon. Offsets come from
`Intl` rather than being hard-coded, so DST is handled wherever it applies, with
a second correction pass for the hour either side of a transition. Seven unit
tests cover Yangon, Seoul, UTC, and New York on both sides of DST.

**All-day plans are stored at midday, not midnight**, so they cannot land on the
previous day when read back from a different offset.

### Not verifiable without keys

Places, Search, and Calendar all need credentials that do not exist yet. The
timezone arithmetic and the tool wiring are tested; the three HTTP integrations
have never made a real request.

## 13. Reminder engine notes (Part 8)

**The sweep never touches the language model.** Principle 1 in AGENTS.md, made
literal: dates live in Postgres and the sweep is arithmetic. The one guarantee
this feature needs is the one an LLM cannot give.

**The firing rule is a pure function.** `selectDueDates` takes rows and returns
decisions, with no I/O anywhere near it, because it is the single most important
rule in the project — the difference between remembering an anniversary and
missing one. Fourteen unit tests cover lead times, custom leads, silence on
non-lead days, ages, expired one-offs, and a leap birthday firing in a non-leap
year.

**Idempotency lives on the row.** Vercel Cron guarantees the hour, not the
minute, and may retry. `last_notified_on` is compared against today in the
owner's timezone, so a second run the same day stays silent.

**Rows are only marked as notified once delivery succeeds.** Marking on failure
would lose the reminder entirely, which is the single outcome worth avoiding.

**One message, not one per item.** Three separate pings about the same morning
is how a person learns to swipe the notification away without reading it.

**Telegram uses HTML, not MarkdownV2.** MarkdownV2 requires eighteen characters
escaped anywhere in the message and rejects the whole thing if one is missed — a
surname with a hyphen would silently lose a reminder. HTML needs three.

**Email is a fallback, not a copy.** Delivery stops at the first success. Being
told twice about the same birthday trains you to ignore both.

**Every attempt is logged** to the `notifications` table. "Did it send?" has to
be answerable, or the system cannot be trusted.

**The cron secret is compared in constant time**, so a wrong secret cannot be
narrowed down by timing the response. `?dryRun=1` reports what would be sent
without sending or marking anything.

**Schedule: 00:00 UTC daily**, the most Vercel Hobby allows. That lands at 06:30
in Yangon, which is a reasonable hour to learn that a birthday is tomorrow.

**Lead times are capped at 90 days** in the tool schema, matching the sweep's
lookahead, so nothing can be stored that the sweep would silently never fire.

## 14. Deployment notes (Part 9)

**No secrets reach the browser.** The built client bundle was scanned for every
value in `.env.local` and for the variable names themselves, with a positive
control to prove the scan could actually find things. Nothing present.

**Security headers are set in `next.config.ts`.** This is a single-user
assistant holding intimate details about people, on a public URL, so the
defaults are not enough: `nosniff`, `X-Frame-Options: DENY`, a strict referrer
policy, HSTS, and no `X-Powered-By`. Everything under `/api` is additionally
`no-store` — every route there is either personal data or an action.

**`Permissions-Policy` allows `microphone=(self)` explicitly.** A default-deny
policy makes the browser refuse speech recognition silently, with no error
anywhere, and the voice feature simply stops working.

**`/api/health` is a two-tier probe.** Unauthenticated callers get liveness
only; the detailed subsystem report sits behind the cron secret, because on a
public URL an unauthenticated inventory of your integrations is free
reconnaissance. It reports booleans and table names, never a credential. It also
distinguishes "database reachable" from "migration actually ran", which is the
most common broken deploy.

**Deploy is via GitHub rather than the CLI**, which is the supported path for
cron jobs and gives deploys on push.

### What could not be done here

Deployment itself needs authentication to accounts that belong to the user:
Vercel, Neon, Telegram, Google Cloud. The runbook in `DEPLOY.md` is written to
be followed step by step, but the steps are theirs to run.

## 15. Conversation persistence (Part 10)

Added after a review pass, not part of the original plan. The `conversations`
and `messages` tables had existed since Part 1 with nothing writing to them,
which left two things wrong:

- The assistant forgot everything on reload. For something whose whole purpose
  is remembering the people in your life, that is a poor first impression.
- `memories.source_message_id` was always null, so the Part 4 claim that it
  "keeps the receipt so you can always see where a fact came from" was untrue.

**Every turn is persisted, and every stored fact points at the message that
produced it.** `sourceMessageId` travels through `ToolContext` into
`remember_fact`, so "why do you think that?" now has an answer.

**Persistence never fails a reply.** Every database call on this path is
wrapped: if the write throws, the conversation still happens, it simply is not
remembered. An answer already delivered must not be swallowed by bookkeeping.

**The conversation id is sent before the reply starts**, so a reload can pick
the thread back up even if generation fails halfway through.

**Clearing deletes server-side.** Leaving the row would make the next reload
resurrect a conversation the user deliberately dismissed.

**Titles come from the first message, not from a model call.** A title is worth
almost nothing, and spending a request, a second, and free-tier quota on one is
a poor trade against a 30s ceiling.

**A `conversationIdRef` mirrors the state** so `send` can read it without
listing it as a dependency and being rebuilt every turn. The restore path writes
both — setting only the state would silently start a new thread on the next
message after a reload.

**Without a database it degrades to stateless**, returning an empty conversation
rather than an error the user can do nothing about.

## 16. Verification against a real database

The database layer was written across Parts 1, 4, 7, 8, and 10 without ever
running. That is now closed, using Postgres in Docker rather than waiting on a
hosted account.

`npm run db:local` starts Postgres 17 with pgvector; `npm run db:migrate:local`
applies the migration. **The migration ran clean on the first attempt** — all
seven tables and the vector extension.

**The client picks its driver from the URL.** Neon's HTTP driver only speaks to
Neon, so anything else goes through node-postgres. Same Drizzle, same schema,
same SQL; only the transport differs. This means the app runs end to end with no
Neon account at all, which is what made the verification below possible.

### What was proven

Fourteen integration tests against real Postgres, plus a full pass through the
running app:

- Person resolution by name, nickname, alias, and case, including an ambiguous
  prefix correctly returning nothing rather than guessing
- Updates merging without blanking stored fields
- Dates deduplicating on repeat, and 31 February rejected
- The `upcoming` query returning the right rows with the right `daysAway`
- Semantic recall with live Gemini embeddings: "what food should Nandar avoid"
  retrieves "allergic to peanuts", sharing no words with the query
- Conversations replaying in order, and a stored fact carrying a real
  `source_message_id`
- The reminder sweep selecting exactly the right row from real data

End to end through the app: one sentence stored a person, a date, and a fact,
each with an undo card; a later question recalled the fact semantically; and the
sweep reported "Nan's Birthday is tomorrow (28 August) — turning 28."

### Still unverified

Telegram and email delivery, and the three Google integrations, all need
credentials. The sweep's selection is proven; the send is not.

## 17. Memory page and the duplicate-people bug

**A memory page you can audit.** Everything stored — people with their dates
and facts, what is coming up, plans, loose notes — on one page at `/memory`,
each row with a way to forget it. The undo card catches a wrong fact in the
moment; this catches one weeks later. Forgetting takes two taps, because the
page is dense with small buttons and a stray one should not quietly erase a
birthday.

**Unconfirmed facts are labelled `inferred`**, so the ones the assistant guessed
at are visibly the likelier ones to be wrong.

### The bug this found

Seeding the page through conversation showed a person missing from the write
log. Chasing it turned up something worse: **concurrent `upsertPerson` calls
created one row per call.** A stress test produced eight rows for eight
concurrent calls.

This was reachable in normal use. The agent runs each batch of tool calls
concurrently through `Promise.all`, so `remember_person("Nandar")` and
`remember_date(person: "Nandar")` — which the model routinely emits together —
both ran find-then-insert at the same moment. It had stayed hidden only because
the person already existed from an earlier run.

Find-then-insert cannot be made atomic in application code, so the database
enforces it: a unique index on `lower(name)`, with the insert doing
`ON CONFLICT DO NOTHING` and the loser of the race falling through to the merge
path. Verified: eight concurrent calls now produce one row, and the merged
detail survives.

**Tests now clean up after themselves.** The rows left behind by a suite run
were what masked this in the first place — they turned up in the running app and
made the next thing looked at inexplicable.

**"Turning" is only used for birthdays.** A person turns 28; a marriage does
not. Anniversaries read "6 years", memorials "6 years on".

## 18. The daily brief

Opening the assistant used to show an orb and an invitation to type. It now
shows the day: what is on, who has a birthday coming, sorted so that today and
tomorrow lead. An assistant that knows a birthday is tomorrow and waits to be
asked is not much of an assistant.

**A glance, not a dashboard.** Six items at most, a week ahead at most. It sits
in the empty state and disappears the moment a conversation starts, so it can
never compete with what is being said.

**Undated tasks are excluded.** A task with no deadline is still a task, but it
has no place in a brief about today — it stays on the memory page.

**Timing is phrased relative to now.** "today at 14:30", not "Mon 24 Aug,
14:30". The same reasoning as not saying "turning 6" about a wedding: the
assistant should sound like it knows what day it is.

**A quiet day says so.** "Nothing on this week" rather than an empty frame.

**The brief never breaks the app.** If the database is unreachable the load is
caught and the assistant opens as it always did.

### An invisible bug worth recording

The first version of the relative phrasing silently failed: plans showed "today"
instead of "today at 14:30". The regex in the source was
`/\b(\d{2}:\d{2})\b/` — except those `\b` were literal **backspace control
characters**, written by a scripted edit whose escaping collapsed them.

Both `grep` and a file read displayed the line as correct, because a backspace
is invisible in a terminal. Only `JSON.stringify` on the raw bytes showed it.
A test caught the behaviour; the cause took a byte-level look to find.

The whole tree was then swept for stray control characters: 69 files, clean.

## 19. Conversation threads

Clearing the screen used to delete the conversation outright. Tidying a view and
destroying history are different intentions, and only one of them can be undone
— so the button is now **New conversation**, and the previous thread is kept.

Past threads have been stored since Part 10 with no way back to them, and
`listConversations` sat unused the whole time. A history panel in the header now
lists them newest first, switches between them, and deletes one explicitly.
Deletion cascades to its messages.

**The list is fetched on the click, not in an effect keyed to the open state**,
which would set state during render and cascade.

**The panel closes on an outside click or Escape.** A panel that swallows the
next click anywhere is worse than no panel.

**Loading a thread reads the real row.** The route previously fabricated
`{ id, title: null, lastMessageAt: now }` when given an id — data that was
simply untrue, and would have been wrong the moment anything relied on it. An
unknown id now returns nothing rather than an invented conversation.

## 20. Correcting what is remembered

The memory page could delete but not correct. If a name was stored slightly
wrong or a date landed a day off, the only route was to destroy the row and
re-tell it — losing when the fact was learned and its link back to the message
that produced it. For a memory system that is the wrong trade.

People, dates, and notes are now editable in place, via `PATCH /api/memory`.

**Only the fields sent are touched.** A form showing four of a person's six
fields must not blank the two it does not show. An empty string means "clear
this", which is deliberately different from a field being absent.

**An empty numeric field means unknown.** A birth year nobody knows is a real
state, and not the same as zero.

**Editing a note re-embeds it.** Otherwise recall keeps matching the old
wording and the correction is invisible to the part of the system that uses it
most. Verified end to end: correcting "allergic to peanuts" to "allergic to
shellfish" changed the stored vector, and asking "what seafood should Nandar
avoid" then returned the corrected note at 0.85 similarity.

**An edited note becomes confirmed.** It was written by the owner, so it is no
longer the assistant's guess.

**A corrected date clears `last_notified_on`.** Whatever was sent about the old
date has no bearing on the new one.

**Partial date edits are validated against what is stored**, not in isolation,
so changing only the month still catches 31 February.

**Failed embeddings do not lose the correction**, same rule as storing: the
text is saved with a null vector, which drops it out of recall until backfilled
rather than throwing the edit away.

## 21. Telegram, both ways

Kayv could send to Telegram; now it listens there too. This is the single
highest-value thing left, because the barrier to a memory assistant is not
capability but friction: opening a browser tab to write down "Su's mother's
birthday is 3 March" is enough work that it does not happen, and an assistant
you never tell things to is worthless. Messaging a contact from a lock screen
is not.

**Transport only.** The webhook and the local poller both call the same
`handleMessage`, which runs the same agent loop, tools, and memory the web uses.
Nothing about the assistant's behaviour lives here.

**Two locks on the door.** The webhook URL is public, so it checks Telegram's
own secret header in constant time *and* that the message came from the owner's
chat id. Either alone is too thin: the header alone would let anyone who
obtained the secret through, and the chat check alone would leave the endpoint
open to anyone who found the URL. A stranger gets silence, not a refusal —
replying would confirm the bot is live.

**Always 200.** A non-200 makes Telegram redeliver the same update, which would
repeat whatever half-finished thing just failed.

**One thread, shared with the web.** Something said on Telegram appears in the
history panel, and a question asked there knows what was discussed at a desk an
hour earlier. For one person, continuity beats isolation.

**Local polling exists so this is testable.** Webhooks need a public URL that a
laptop does not have. `npm run telegram` long-polls and feeds the identical
handler, so what is exercised in development is what runs in production.

### Two bugs this found

**The Telegram budget was 20s against the web's 25s** — backwards. Telegram
shows no partial output, so a turn that runs out of time looks like silence and
needs *more* headroom, not less. Under a rate-limited free tier this meant
capture appeared to fail even though the fact had been stored. The webhook now
gets 25s, bounded by Vercel's 30s kill; local polling has no such ceiling and
gets 60s.

**A raw Google error object was sent to a phone.** The web route mapped provider
errors to plain sentences; the Telegram path forwarded `event.message` verbatim.
Fixed by moving the mapping into `describeAgentError`, shared by both.

Error events now carry an `origin`. Guessing whether a message was ours from its
shape was fragile and swallowed our own, more specific wording; the loop simply
says who wrote it. `origin` defaults to `"provider"`, so a caller that forgets
cannot thereby have a payload forwarded verbatim.

## 22. Reminders that carry what you know

"Nan's birthday is in seven days" is half the job. The half that matters is
"...and she has been wanting a film camera, and she cannot eat peanuts."
Remembering the date is bookkeeping; remembering what to do about it is the
reason to keep a memory assistant at all.

Each due date now carries the person's notes and up to three stored facts,
indented beneath it so the reminder still reads as one thing.

**Confirmed facts come first.** Those were stated outright rather than inferred,
so they are the ones worth putting in front of someone as if true.

**No model is involved.** Principle 1 in AGENTS.md: this reads stored rows
directly. A reminder that depends on an LLM being available is a reminder that
will one day not arrive. Context is also a bonus — if the extra lookup fails,
the reminder still goes out plainer rather than not at all.

**Looked up after selection**, so it costs nothing on the days nothing is due.

### Two bugs this found

**`= ANY($1)` with a JavaScript array does not work.** Binding an array as one
parameter flattens it and throws. The pattern appeared in four places, and two
of them were the queries that mark reminders as sent. The failure mode was the
worst available: the message goes out, the mark fails, and the same reminder
arrives again tomorrow and the day after — exactly what the idempotency guard
exists to prevent. It survived because marking only runs after a successful
delivery, which needs a configured channel, so a dry run never reaches it. All
four now use `inArray`, and `markNotified` is separated and tested directly.

**Concurrent upserts lost each other's fields.** The unique index stopped
duplicate rows, but the update path still read a row and wrote every column
back. Several concurrent calls each held a snapshot from before the others
committed, so one that knew nothing about the relationship wrote back the null
it had read and erased what a sibling had just set. A stress run lost a field in
ten rounds out of fifteen. Now only the fields a call actually learned are
written, and anything that has to combine with the stored value — aliases,
notes — is combined in SQL at write time. Fifteen rounds, nothing lost.

Related: a JavaScript array bound as a single parameter is not a Postgres array
literal there either. Each alias is bound separately.

## 23. Repeating plans

Daily life is mostly repeating — medicine, a weekly call, rent on the 1st — and
a to-do list that can only hold one-off items is one you stop trusting. Plans
now carry a recurrence: daily, weekly with named weekdays, monthly, or yearly.

**The occurrence rule is pure and separately tested**, for the same reason the
date-firing rule is: it decides whether a reminder fires. Ten tests cover
month-end clamping, leap days, and the "nothing fires before it starts" rule —
"every Tuesday" said on a Wednesday means next Tuesday, not retroactively.

**Month-end clamps rather than skips.** Someone paying rent on the 31st still
pays it in November; a 29 February plan is observed on the 28th in a common
year. Skipping would be the wrong answer to an edge case, not a safe one.

**Occurrences are matched in JavaScript, not by a date window.** A repeating
plan's next occurrence is not a stored timestamp — "every Tuesday" has no row
for next Tuesday — so `starts_at BETWEEN` would silently miss every repeating
plan. One person's list is small enough that correctness beats an index here.

**`notified_at` became `last_notified_on`.** A date rather than a timestamp,
shared by one-off and repeating plans alike: a one-off only ever falls due on
its own day, so "once per day" and "once ever" are the same guarantee for it,
and one mechanism is easier to reason about than two.

### A bug this found

**A repeat with no start date silently became an undated task.** The recurrence
had nothing to anchor to, so the plan vanished from the brief and never fired.
The tool happened to default the date, but the invariant belongs with the data:
`addPlan` now anchors a repeat to today, which is what "every morning" said
today means anyway.

### Known limit: time of day

A plan stored for 21:00 is reported in the morning digest, not at 21:00. Vercel
Hobby runs cron once a day, so there is no run near nine in the evening to send
it. Firing punctually needs a scheduler that can run hourly — a free external
pinger against `/api/cron/reminders` would do it, and the sweep is already
idempotent so extra runs are harmless. Deliberately not half-built: a reminder
that arrives at the wrong time is worse than one that arrives as a digest.

## 24. The world map

Point anywhere on Earth and read the time and the weather there. Built in
parts, because each one has a different failure mode.

**The map itself.** A wireframe, not tiles. Photographic imagery would fight
everything else on screen, and tiles mean a billed key for something whose only
job is answering "where did you point?". `d3-geo` and `world-atlas` generate the
land, border and graticule paths on the server; the browser receives three
strings and never sees the libraries — worth checking, since the topology alone
is larger than the rest of the client bundle.

The projection is equirectangular at `scale(180/π)`, which makes one SVG unit
exactly one degree. Turning a click into coordinates is then subtraction rather
than a projection library shipped to the client. The pointer position is read
from the SVG's own coordinate space via `getBoundingClientRect`, not from the
element's pixel box, so it stays correct at any panel size — including full
screen, where the two differ a great deal.

**The clock.** `tz-lookup` is a 72KB offline table from coordinate to IANA
zone, so the time appears the instant you click, with no network. Daylight is a
solar-elevation calculation rather than "is it between six and six", because the
naive version is wrong for a third of the year above the Arctic circle —
Svalbard in June is lit at local midnight, and McMurdo is dark at noon in
December. Both are tested. Open ocean answers with `Etc/GMT±n` rather than
throwing, so a click that misses land does not break the panel.

The clock recomputes each second rather than incrementing, so it survives the
machine sleeping or the system clock being adjusted underneath it. It renders
only after a click, which means a live clock never has to agree with anything
the server rendered — no hydration mismatch to suppress.

**The weather.** Open-Meteo, behind a `WeatherProvider` interface for the same
reason as `LLMProvider`: free and keyless makes it the right first choice, not
necessarily the last. It answers for any coordinate on Earth including open
ocean, which a map you can click anywhere on requires.

Three deliberate choices. Requests go through `/api/weather` rather than
straight from the component, so one process talks to a free service instead of
every open tab holding its own cache that dies on reload. Coordinates are
rounded to one decimal — about 11km — before both caching and requesting, so
dragging the pointer cannot fire a request per pixel. And a failure returns
`null` with a 200, not a 502: "no reading for this point" is an ordinary answer
on a map, and the panel says so in a line rather than turning red.

Each answer is tagged with the coordinates it answers for, and the component
derives its loading state by comparing that tag against the current point. This
is the structural fix for a real race — click three places quickly and a slow
reply for the first can land after a fast reply for the third, showing
Reykjavik's weather under Yangon's clock. Tagging makes a stale answer
unrenderable rather than merely unlikely.

WMO weather codes are mapped to words by hand rather than derived, because the
groupings are not regular: 45 and 48 are both fog, 51/53/55 are drizzle by
intensity, but 56/57 are freezing drizzle and 66/67 are freezing rain. An
unknown code reports "unknown conditions" rather than guessing.

**Asking out loud.** A `weather_at` tool, so "what's it like in Tokyo?" is
answered rather than guessed at. It joins the builtins rather than the
credentialed tools, because both the geocoder and the weather service are
keyless — it cannot be the tool that always fails on a fresh checkout, which is
what teaches a model to stop reaching for something.

It returns the local time alongside the conditions. The two questions arrive
together often enough, and the time costs nothing extra: it is an offline table
lookup, not a second round trip. When the weather service is down the tool still
returns the time rather than throwing away the half of the answer that worked.

Place names are resolved with Open-Meteo's geocoder, kept deliberately separate
from `find_places` — that searches for businesses near you, this puts a town on
the globe, and one tool with two jobs is how a model ends up calling the wrong
one.

The interesting problem is ranking. The geocoder orders by population, which is
a poor proxy for what a person has in mind: ask for Bagan and it offers a
Russian village of 5,800 ahead of the temple city in Myanmar, whose resident
population is 300. The fix reuses what is already there — every candidate
carries a timezone, so a candidate matching the user's own timezone is preferred
as a cheap stand-in for "same country". Where that guesses wrong (a British user
saying "Boston" gets Lincolnshire, not Massachusetts) the reading is still
defensible, and the tool reports that it overrode the ranking so the assistant
says which one it used. Alternatives come back either way, capped at three,
because the tail is noise the model pays for on every call.

**Pointing and asking.** The map and the conversation were two panels that
did not know about each other; you could read Reykjavik's weather off the map
and then have to type "Reykjavik" to ask about it. The selected point now
travels with every turn as a `focus` on the chat request.

Sent per turn rather than stored, because it is a property of the moment — the
point they had selected when they asked, not a preference to be remembered.
Attached to the request rather than pasted into the message, so "what about
here?" reads as a question in the transcript instead of a string of
coordinates.

The hook takes a *getter* for the focus rather than a value. That means the
assistant hook never holds or synchronises map state, and — the reason it is
worth doing this way — a spoken turn carries the same context as a typed one
without the voice path knowing the map exists.

The prompt says plainly that the point is a raw map coordinate rather than a
named place, and tells the model to pass the coordinates through to
`weather_at` instead of translating them. Without that the failure is
predictable and confident: read 21.17°N 94.86°E, decide it is "Mandalay", and
answer about a city a hundred kilometres away.

There is a test asserting that every tool the prompt names is actually
registered. Nothing else imports those strings, so renaming a tool would
otherwise leave the model being told to call something that no longer exists.

**Home.** `HOME_LOCATION` was empty, so asking "what's the weather?" with
nothing selected answered "there is nowhere to check", and the map opened
blank. It is now set, parsed in one place, and drawn.

One parser, because there were two — the places tool read the variable its own
way and the weather tool another, which is precisely how two pieces of code end
up disagreeing about where the user lives. Writing the tests for it found a
real bug: `Number("")` is 0 rather than NaN, so `"16.84,"` parsed happily as a
point in the Atlantic. Empty halves and out-of-range latitudes are both now
rejected — "96.17,16.84" is Yangon written backwards, and taken at face value
it is a spot in the Arabian Sea whose weather would be reported without
complaint.

The map opens on home rather than empty. A blank panel saying "click to select"
teaches nothing; one already showing your own time and weather shows what a
click is for. It is safe for hydration because the readouts render a
placeholder and fill in from an effect, so the server and the first client
paint agree.

Home is also marked permanently, as an amber diamond — a different shape as
well as a different colour, because the two markers overlap when you click near
home and colour alone would not separate them for anyone who cannot tell amber
from cyan.

## 25. More than one model

Risk R2 was that Google narrows the free tier. It did not need to — a day of
testing exhausted it, and every turn came back "I've used up today's free
allowance". The answer is what `types.ts` promised on day one: a second file,
not a refactor.

**Measured before choosing.** A turn here costs roughly 7,000 tokens: about
2,900 of fixed overhead — 809 for the system prompt, 2,095 for thirteen tool
schemas — resent on every call, times the two-or-more calls a tool-using turn
takes. That reframes the comparison entirely. The binding limit is tokens per
day, not requests per day, so Groq's 14,400-requests-a-day headline is beside
the point; its 200K token ceiling caps this app at about 28 turns. The current
Gemini free tier is genuinely better for this workload than the obvious
alternative, which is not what the marketing pages suggest.

**One adapter, four vendors.** Groq, Cerebras, Mistral and OpenRouter all speak
OpenAI's chat-completions shape, so they differ only by base URL, model and key.
Gemini keeps its own adapter because it is a genuinely different protocol.

The decoding is where the risk lives, not the HTTP. Tool calls arrive split
across chunks — the name once, then arguments as JSON fragments that are not
individually parseable — so they are assembled by `index` and emitted only when
the stream ends. Two details are each one character wide and each would fail
quietly: merging the name with `||` rather than `??`, because a continuation
fragment carrying `name: ""` would otherwise erase the real one and drop the
call; and keeping the tail of the read buffer, because a chunk boundary can
land in the middle of a JSON object. Both have tests, the second driven a byte
at a time.

**The trap worth naming.** Four call sites embedded through `getProvider()`.
Had the chat provider become swappable without touching them, selecting Groq
would have embedded new memories with a different model — and vectors from two
models are not comparable, so the write would succeed, the fact would be
unfindable, and recall would degrade with nothing in the logs. `getChatProvider`
and `getEmbeddingProvider` are now separate functions; embedding is Gemini
permanently, and the OpenAI-compatible adapter refuses to embed at all rather
than doing it plausibly.

**Fallback order.** Not the order of the headline numbers. Cerebras has by far
the largest token budget and sits fourth, because its free tier caps context at
8K and fallback fires part-way through a conversation — exactly when the history
is already long. The provider most likely to refuse is the one whose daily
allowance looks best on paper. Mistral is last: its free tier trains on your
data unless you opt out, and this assistant stores facts about people.

## 26. Falling back on its own

A picker alone would not solve the problem it was asked to solve: you only
reach for it once you have already been told the day's allowance is gone. So
the chain switches by itself, and reports that it did.

**Two rules carry the design, and both are about what has already been said.**

*Never switch after output has started.* Once a delta has streamed the user is
reading a sentence, and half of one model's answer followed by half of
another's is worse than an honest failure. A tool call counts as having
started too — the loop has already run it, and repeating the turn elsewhere
would repeat whatever that tool did. Usage does not count: it arrives after the
fact and is invisible.

*Once it falls back, it stays fallen back.* This one is Gemini-specific and
easy to miss. Gemini refuses a follow-up whose function call has lost its
thought signature, and a call made by Groq has no signature to carry. A second
iteration of the agent loop that drifted back to Gemini would hand it a tool
call it considers malformed and lose the turn to a self-inflicted error. So the
chain's position advances and never retreats, for the life of one request.

A non-retryable failure stops the chain rather than walking it. No other vendor
can fix a bad key or a malformed request, and trying would spend the 25-second
budget discovering that four times over.

**Saying who answered.** A `model` event opens every turn and repeats on each
switch, so an answer from a model you did not choose never arrives unexplained.
The catalog is looked up by provider and vendor model name, not by reassembling
an id — `groq/llama-3.3-70b` is deliberately shorter than
`llama-3.3-70b-versatile`, and the first version of this matched nothing.

**Found by testing against the live endpoints.** Pointing a deliberately bad key
at all four vendors proved the URLs, headers and auth scheme reach real servers,
and turned up one real bug: three of them phrase a rejection in an `error` or
`message` field and Mistral uses `detail`, so its raw JSON was being shown to
the user as the error message.

The route no longer refuses to start without `GEMINI_API_KEY`, which would have
turned away a perfectly good setup running on Groq. It now asks whether *any*
model is configured.

## 27. Open questions

- [ ] Exact memory write policy: which fact types auto-save vs. need confirmation
- [ ] How far back conversation context is replayed into each turn (cost vs. continuity)
- [ ] Whether Burmese TTS is worth paying for once the rest works
