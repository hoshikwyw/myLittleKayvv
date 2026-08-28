import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { connect, disconnect, isReachable, reset } from "./helpers/db";
import { findPerson, listPeople, personProfile, upsertPerson } from "@/lib/memory/people";
import { addImportantDate, upcomingDates } from "@/lib/memory/dates";
import { recallMemories, storeMemory } from "@/lib/memory/facts";
import { addPlan, completePlanByTitle, listPlans } from "@/lib/memory/plans";
import {
  appendMessage,
  ensureConversation,
  loadTurns,
  latestConversation,
  titleFromFirstMessage,
} from "@/lib/memory/conversations";
import { runReminderSweep } from "@/lib/reminders/sweep";

/**
 * These run the real code against a real Postgres with pgvector.
 *
 * Unit tests prove the arithmetic; only this proves the SQL. Start the database
 * with `npm run db:local` — without one the whole suite skips rather than
 * failing, so `npm test` stays useful on a machine with no Docker.
 */

// Checked inside `before` rather than at module scope: tsx compiles these to
// CommonJS, where top-level await is not available.
let reachable = false;
let db: Awaited<ReturnType<typeof connect>>;

/** A test that skips itself, rather than failing, when no database is up. */
function dbTest(name: string, fn: () => Promise<void>) {
  test(name, async (t) => {
    if (!reachable) return t.skip("no database — run npm run db:local");
    await fn();
  });
}

describe("memory against real Postgres", () => {
  before(async () => {
    reachable = await isReachable();
    if (reachable) db = await connect();
  });

  after(async () => {
    // Leave nothing behind: rows surviving a test run turn up in the running
    // app and make the next thing you look at inexplicable.
    if (reachable) {
      await reset(db);
      await disconnect();
    }
  });

  dbTest("a person can be found by name, nickname, or alias", async () => {
    await reset(db);

    const { person, created } = await upsertPerson({
      name: "Nandar Aye",
      nickname: "Nan",
      aliases: ["my sister", "Nandar"],
      relationship: "sister",
    });
    assert.equal(created, true);

    for (const term of ["Nandar Aye", "nandar aye", "Nan", "my sister", "NANDAR"]) {
      const found = await findPerson(term);
      assert.equal(found?.id, person.id, `should have found via "${term}"`);
    }

    // An unambiguous prefix resolves; a stranger does not.
    assert.equal((await findPerson("Nanda"))?.id, person.id);
    assert.equal(await findPerson("Someone Else"), undefined);
  });

  dbTest("an ambiguous prefix returns nothing rather than guessing", async () => {
    await reset(db);
    await upsertPerson({ name: "Aung Min" });
    await upsertPerson({ name: "Aung Thu" });

    // Two candidates: asking is right, picking one at random is not.
    assert.equal(await findPerson("Aung"), undefined);
    assert.ok(await findPerson("Aung Min"));
  });

  dbTest("updating a person never blanks out what was already known", async () => {
    await reset(db);

    await upsertPerson({
      name: "Thiri",
      relationship: "colleague",
      pronouns: "she/her",
      aliases: ["T"],
    });

    // A later mention that volunteers less must not erase the earlier detail.
    const { person, created } = await upsertPerson({
      name: "Thiri",
      nickname: "Thi",
      aliases: ["Thiri Win"],
    });

    assert.equal(created, false);
    assert.equal(person.relationship, "colleague");
    assert.equal(person.pronouns, "she/her");
    assert.equal(person.nickname, "Thi");
    assert.deepEqual([...person.aliases].sort(), ["T", "Thiri Win"]);
  });

  dbTest("dates attach to people and read back with them", async () => {
    await reset(db);
    const { person } = await upsertPerson({ name: "Nandar" });

    await addImportantDate({
      personId: person.id,
      label: "Birthday",
      kind: "birthday",
      month: 3,
      day: 3,
      year: 1998,
    });

    const profile = await personProfile(person);
    assert.equal(profile.dates.length, 1);
    assert.equal(profile.dates[0].label, "Birthday");
    assert.equal(profile.dates[0].month, 3);

    // The same date told twice updates rather than duplicating.
    await addImportantDate({
      personId: person.id,
      label: "birthday",
      month: 3,
      day: 4,
    });
    const again = await personProfile(person);
    assert.equal(again.dates.length, 1);
    assert.equal(again.dates[0].day, 4);
  });

  dbTest("31 February is refused", async () => {
    await reset(db);
    await assert.rejects(() =>
      addImportantDate({ label: "Nonsense", month: 2, day: 31 }),
    );
  });

  dbTest("upcoming dates are found by month and day", async () => {
    await reset(db);
    const now = new Date("2026-08-24T06:00:00Z");

    const { person } = await upsertPerson({ name: "Nandar", nickname: "Nan" });
    await addImportantDate({
      personId: person.id,
      label: "Birthday",
      kind: "birthday",
      month: 8,
      day: 26,
      year: 1998,
    });
    await addImportantDate({ label: "Far away", month: 12, day: 25 });

    const soon = await upcomingDates(7, now);
    assert.equal(soon.length, 1);
    assert.equal(soon[0].personName, "Nan");
    assert.equal(soon[0].daysAway, 2);
    assert.equal(soon[0].turning, 28);

    // Widen the window and the December date appears.
    assert.ok((await upcomingDates(200, now)).length === 2);
  });

  dbTest("plans are stored, listed, and completed", async () => {
    await reset(db);
    const now = new Date("2026-08-24T06:00:00Z");

    await addPlan({ title: "Dentist", date: "2026-08-25", time: "14:30" });
    await addPlan({ title: "Buy a gift" }); // undated

    const listed = await listPlans(7, now);
    assert.equal(listed.length, 2);

    // An undated task is still a task and must not be hidden.
    assert.ok(listed.some((p) => p.title === "Buy a gift" && p.when === null));

    const dentist = listed.find((p) => p.title === "Dentist");
    assert.match(dentist!.when!, /14:30/);

    const done = await completePlanByTitle("dentist");
    assert.equal(done?.status, "done");
    assert.equal((await listPlans(7, now)).length, 1);
  });

  dbTest("conversations persist and replay in order", async () => {
    await reset(db);

    const id = await ensureConversation();
    const userMessageId = await appendMessage(id, "user", "My sister is Nandar.");
    await appendMessage(id, "assistant", "Noted.");
    await titleFromFirstMessage(id, "My sister is Nandar.");

    const turns = await loadTurns(id);
    assert.deepEqual(
      turns.map((t) => [t.role, t.content]),
      [
        ["user", "My sister is Nandar."],
        ["assistant", "Noted."],
      ],
    );

    const latest = await latestConversation();
    assert.equal(latest?.id, id);
    assert.equal(latest?.title, "My sister is Nandar.");

    // An existing id is reused rather than starting a second thread.
    assert.equal(await ensureConversation(id), id);
    assert.ok(userMessageId);
  });

  dbTest("a stored fact keeps a link to the message that produced it", async () => {
    await reset(db);

    const conversationId = await ensureConversation();
    const messageId = await appendMessage(
      conversationId,
      "user",
      "Nandar is allergic to peanuts.",
    );

    const memory = await storeMemory({
      content: "Nandar is allergic to peanuts.",
      sourceMessageId: messageId,
      confirmed: true,
    });

    assert.equal(memory.sourceMessageId, messageId);
  });

  dbTest("the reminder sweep selects the right rows from real data", async () => {
    await reset(db);
    // 06:00 UTC is already the 24th in Yangon.
    const now = new Date("2026-08-24T06:00:00Z");

    const { person } = await upsertPerson({ name: "Nandar", nickname: "Nan" });

    // Due tomorrow, and this date asks for a day of warning.
    await addImportantDate({
      personId: person.id,
      label: "Birthday",
      kind: "birthday",
      month: 8,
      day: 25,
      year: 1998,
      remindDaysBefore: [1],
    });
    // Also two days out, but only wants to hear on the day itself.
    await addImportantDate({
      label: "Rent due",
      month: 8,
      day: 26,
      remindDaysBefore: [0],
    });

    const result = await runReminderSweep(now, { dryRun: true });

    assert.equal(result.today, "2026-08-24");
    assert.equal(result.due.length, 1);
    assert.match(result.due[0].line, /Nan's Birthday is tomorrow/);
    assert.match(result.due[0].line, /turning 28/);
    // Dry run must not mark anything as sent.
    assert.equal(result.delivered, false);
  });

  dbTest("concurrent upserts cannot create duplicate people", async () => {
    await reset(db);

    // The agent runs a batch of tool calls through Promise.all, so
    // remember_person and remember_date for the same person land at the same
    // moment. Before the unique index on lower(name), this produced one row
    // per concurrent call.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        upsertPerson({
          name: "Nandar",
          relationship: i === 0 ? "sister" : undefined,
        }),
      ),
    );

    const everyone = await listPeople();
    assert.equal(everyone.length, 1, "expected exactly one Nandar");
    // The loser of the race still merges rather than overwriting.
    assert.equal(everyone[0].relationship, "sister");
  });

  dbTest("names collide case-insensitively", async () => {
    await reset(db);

    await upsertPerson({ name: "Nandar" });
    const { created } = await upsertPerson({ name: "NANDAR" });

    assert.equal(created, false);
    assert.equal((await listPeople()).length, 1);
  });

  dbTest("everyone is listed, most important first", async () => {
    await reset(db);
    await upsertPerson({ name: "Ordinary", importance: 0 });
    await upsertPerson({ name: "Central", importance: 9 });

    const everyone = await listPeople();
    assert.deepEqual(everyone.map((p) => p.name), ["Central", "Ordinary"]);
  });
});

/**
 * Semantic recall needs a real embedding model as well as a real database, so
 * it is separated — the rest of the suite should still run without a key.
 */
describe("semantic recall", () => {
  let ready = false;

  before(async () => {
    reachable = await isReachable();
    ready = reachable && Boolean(process.env.GEMINI_API_KEY);
    if (!ready) return;

    db = await connect();
    await reset(db);

    const { person } = await upsertPerson({ name: "Nandar", nickname: "Nan" });

    await storeMemory({
      content: "Nandar is allergic to peanuts.",
      personId: person.id,
      confirmed: true,
    });
    await storeMemory({
      content: "Nandar loves the sea and wants to visit Ngwe Saung.",
      personId: person.id,
    });
    await storeMemory({
      content: "The car insurance is with a company called Grand Guardian.",
    });
  });

  after(async () => {
    if (ready) {
      await reset(db);
      await disconnect();
    }
  });

  function recallTest(name: string, fn: () => Promise<void>) {
    test(name, async (t) => {
      if (!ready) return t.skip("needs a database and GEMINI_API_KEY");
      await fn();
    });
  }

  recallTest("finds a fact by meaning rather than wording", async () => {
    // None of these words appear in the stored sentence.
    const hits = await recallMemories({ query: "what food should Nandar avoid" });

    assert.ok(hits.length > 0, "expected at least one memory back");
    assert.match(hits[0].content, /peanuts/);
    assert.ok(hits[0].similarity > 0.35);
  });

  recallTest("unrelated queries do not drag in irrelevant memories", async () => {
    const hits = await recallMemories({ query: "peanut allergy" });
    // The insurance note must not outrank an actual allergy record.
    assert.ok(
      !/insurance/i.test(hits[0]?.content ?? ""),
      `unrelated memory ranked first: ${hits[0]?.content}`,
    );
  });

  recallTest("recall can be narrowed to one person", async () => {
    const person = await findPerson("Nan");
    const hits = await recallMemories({
      query: "holidays and travel",
      personId: person!.id,
    });

    assert.ok(hits.every((h) => h.personName === "Nandar"));
  });
});
