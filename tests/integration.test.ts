import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { connect, disconnect, isReachable, reset } from "./helpers/db";
import { eq as eqFn } from "drizzle-orm";
import { important_dates as schemaImportantDates } from "@/db/schema";
import { findPerson, listPeople, personProfile, upsertPerson } from "@/lib/memory/people";
import { addImportantDate, upcomingDates } from "@/lib/memory/dates";
import { recallMemories, storeMemory } from "@/lib/memory/facts";
import { addPlan, completePlanByTitle, listPlans } from "@/lib/memory/plans";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  ensureConversation,
  getConversation,
  listConversations,
  loadTurns,
  latestConversation,
  titleFromFirstMessage,
} from "@/lib/memory/conversations";
import { markNotified, runReminderSweep } from "@/lib/reminders/sweep";
import { contextForPeople, contextLines } from "@/lib/reminders/context";
import {
  updateImportantDate,
  updateMemoryContent,
  updatePerson,
} from "@/lib/memory/edit";
import { loadDailyBrief } from "@/lib/memory/brief";

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

  dbTest("threads are listed newest first and survive starting a new one", async () => {
    await reset(db);

    const first = await createConversation();
    await appendMessage(first, "user", "What is Nan allergic to?");
    await titleFromFirstMessage(first, "What is Nan allergic to?");

    const second = await createConversation();
    await appendMessage(second, "user", "Plan the weekend trip.");
    await titleFromFirstMessage(second, "Plan the weekend trip.");

    const threads = await listConversations();
    assert.equal(threads.length, 2);
    // Most recently active first.
    assert.equal(threads[0].id, second);

    // Starting a new thread must leave the earlier one intact — tidying the
    // screen and destroying history are different intentions.
    assert.equal((await getConversation(first))?.title, "What is Nan allergic to?");
  });

  dbTest("an unknown conversation id returns nothing rather than a made-up row", async () => {
    await reset(db);
    assert.equal(
      await getConversation("00000000-0000-4000-8000-000000000000"),
      null,
    );
  });

  dbTest("deleting a thread takes its messages with it", async () => {
    await reset(db);

    const id = await createConversation();
    await appendMessage(id, "user", "hello");
    await appendMessage(id, "assistant", "hi");
    assert.equal((await loadTurns(id)).length, 2);

    assert.equal(await deleteConversation(id), true);
    assert.equal(await getConversation(id), null);
    assert.equal((await loadTurns(id)).length, 0);
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

  dbTest("concurrent upserts cannot lose each other's fields", async () => {
    // The subtler half of the same race. Reading a row and writing every
    // column back is a lost update: a call that knew nothing about the
    // relationship writes back the null it read and erases what a sibling
    // call just set. Ten runs in fifteen lost a field before the fix.
    for (let round = 0; round < 5; round++) {
      await reset(db);

      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          upsertPerson({
            name: "Nandar",
            relationship: i === 0 ? "sister" : undefined,
            pronouns: i === 3 ? "she/her" : undefined,
            aliases: i === 5 ? ["my sister"] : undefined,
          }),
        ),
      );

      const [person] = await listPeople();
      assert.equal(person.relationship, "sister", `round ${round}`);
      assert.equal(person.pronouns, "she/her", `round ${round}`);
      assert.ok(person.aliases.includes("my sister"), `round ${round}`);
    }
  });

  dbTest("notes accumulate rather than overwrite", async () => {
    await reset(db);

    await upsertPerson({ name: "Nandar", notes: "Lives in Mandalay." });
    const { person } = await upsertPerson({
      name: "Nandar",
      notes: "Visits at Thingyan.",
    });

    assert.match(person.notes ?? "", /Lives in Mandalay\./);
    assert.match(person.notes ?? "", /Visits at Thingyan\./);
  });

  dbTest("names collide case-insensitively", async () => {
    await reset(db);

    await upsertPerson({ name: "Nandar" });
    const { created } = await upsertPerson({ name: "NANDAR" });

    assert.equal(created, false);
    assert.equal((await listPeople()).length, 1);
  });

  dbTest("the daily brief leads with what is imminent", async () => {
    await reset(db);
    const now = new Date("2026-08-24T06:00:00Z");

    const { person } = await upsertPerson({ name: "Nandar", nickname: "Nan" });
    // Tomorrow.
    await addImportantDate({
      personId: person.id,
      label: "Birthday",
      kind: "birthday",
      month: 8,
      day: 25,
      year: 1998,
    });
    // Later in the week.
    await addImportantDate({ label: "Rent due", month: 8, day: 30 });
    await addPlan({ title: "Dentist", date: "2026-08-24", time: "14:30" });
    // Undated tasks have no place in a brief about today.
    await addPlan({ title: "Someday project" });

    const brief = await loadDailyBrief(now);

    assert.equal(brief.quiet, false);
    assert.ok(!brief.items.some((i) => i.what === "Someday project"));

    // Imminent items sort to the front.
    assert.ok(brief.items[0].imminent);

    const dentist = brief.items.find((i) => i.what === "Dentist");
    // A brief about today says "today", not the date.
    assert.equal(dentist?.when, "today at 14:30");

    const birthday = brief.items.find((i) => i.what.includes("Birthday"));
    assert.match(birthday!.when, /tomorrow/);
  });

  dbTest("an empty brief says so rather than showing a blank frame", async () => {
    await reset(db);
    const brief = await loadDailyBrief(new Date("2026-08-24T06:00:00Z"));

    assert.equal(brief.quiet, true);
    assert.equal(brief.items.length, 0);
    assert.match(brief.today, /August/);
  });

  dbTest("editing a person touches only the fields sent", async () => {
    await reset(db);

    const { person } = await upsertPerson({
      name: "Nandar",
      nickname: "Nan",
      relationship: "sister",
      notes: "loves the sea",
    });

    const updated = await updatePerson(person.id, {
      nickname: "Nan Nan",
      pronouns: "she/her",
    });

    assert.equal(updated?.nickname, "Nan Nan");
    assert.equal(updated?.pronouns, "she/her");
    // Untouched fields survive: a form showing three fields must not blank
    // the three it does not show.
    assert.equal(updated?.relationship, "sister");
    assert.equal(updated?.notes, "loves the sea");
    assert.equal(updated?.name, "Nandar");
  });

  dbTest("an empty string clears a field, which is not the same as omitting it", async () => {
    await reset(db);
    const { person } = await upsertPerson({ name: "Nandar", relationship: "sister" });

    const updated = await updatePerson(person.id, { relationship: "" });
    assert.equal(updated?.relationship, null);
  });

  dbTest("a person cannot be renamed to nothing", async () => {
    await reset(db);
    const { person } = await upsertPerson({ name: "Nandar" });
    await assert.rejects(() => updatePerson(person.id, { name: "   " }));
  });

  dbTest("a corrected date is validated and becomes un-notified", async () => {
    await reset(db);

    const stored = await addImportantDate({
      label: "Birthday",
      kind: "birthday",
      month: 8,
      day: 29,
      year: 1998,
    });

    // Pretend the sweep already fired for it today.
    await updateImportantDate(stored.id, { day: 28 });

    const [row] = await db
      .select()
      .from(schemaImportantDates)
      .where(eqFn(schemaImportantDates.id, stored.id));

    assert.equal(row.day, 28);
    assert.equal(row.month, 8);
    assert.equal(row.year, 1998);
    // A corrected date has not been notified about, whatever happened before.
    assert.equal(row.lastNotifiedOn, null);

    // A partial edit is still checked against what is stored.
    await assert.rejects(() => updateImportantDate(stored.id, { month: 2, day: 31 }));
  });

  dbTest("editing a fact re-embeds it so recall follows the correction", async () => {
    await reset(db);

    const memory = await storeMemory({
      content: "Nandar is allergic to peanuts.",
    });
    assert.ok(memory.embedding, "expected an embedding to begin with");

    const updated = await updateMemoryContent(
      memory.id,
      "Nandar is allergic to shellfish, not peanuts.",
    );

    assert.equal(updated?.content, "Nandar is allergic to shellfish, not peanuts.");
    // An edited note was written by the owner, so it is no longer a guess.
    assert.equal(updated?.confirmed, true);

    // The vector must change, or recall keeps matching the old wording and the
    // correction is invisible to the part of the system that uses it most.
    assert.notDeepEqual(updated?.embedding, memory.embedding);

    const hits = await recallMemories({ query: "what seafood should Nandar avoid" });
    assert.match(hits[0]?.content ?? "", /shellfish/);
  });

  dbTest("a note cannot be edited to nothing", async () => {
    await reset(db);
    const memory = await storeMemory({ content: "Something worth keeping." });
    await assert.rejects(() => updateMemoryContent(memory.id, "   "));
  });

  dbTest("a reminder carries what is known about the person", async () => {
    await reset(db);

    const { person } = await upsertPerson({
      name: "Nandar",
      nickname: "Nan",
      notes: "Lives in Mandalay.",
    });
    await storeMemory({
      content: "Nandar has been wanting a film camera.",
      personId: person.id,
      confirmed: true,
    });
    await storeMemory({
      content: "Nandar might prefer tea.",
      personId: person.id,
      confirmed: false,
    });

    const context = await contextForPeople([person.id]);
    const lines = contextLines(context.get(person.id));

    // Notes first, then facts: stated ones ahead of inferred ones, because
    // those are the ones worth putting in front of someone as if true.
    assert.equal(lines[0], "Lives in Mandalay.");
    assert.equal(lines[1], "Nandar has been wanting a film camera.");
    assert.ok(lines.includes("Nandar might prefer tea."));
  });

  dbTest("someone with nothing stored adds no noise", async () => {
    await reset(db);
    const { person } = await upsertPerson({ name: "Nobody" });

    const context = await contextForPeople([person.id]);
    assert.deepEqual(contextLines(context.get(person.id)), []);
    // An unknown id must not throw.
    assert.deepEqual(
      contextLines((await contextForPeople(["00000000-0000-4000-8000-000000000000"])).get("x")),
      [],
    );
  });

  dbTest("marking reminders as sent actually writes, so they do not repeat", async () => {
    await reset(db);
    const now = new Date("2026-08-28T06:00:00Z");

    const { person } = await upsertPerson({ name: "Nandar" });
    const date = await addImportantDate({
      personId: person.id,
      label: "Birthday",
      kind: "birthday",
      month: 8,
      day: 28,
      year: 1998,
    });
    const plan = await addPlan({ title: "Dentist", date: "2026-08-28" });

    // This runs only after a successful delivery, which a dry run never
    // reaches — long enough for a broken array binding to hide here.
    await markNotified([date.id], [plan.id], "2026-08-28");

    const [storedDate] = await db
      .select()
      .from(schemaImportantDates)
      .where(eqFn(schemaImportantDates.id, date.id));
    assert.equal(storedDate.lastNotifiedOn, "2026-08-28");

    // And the sweep now stays silent, which is the whole point.
    const again = await runReminderSweep(now, { dryRun: true });
    assert.equal(again.due.length, 0);
    // Both the date and the plan were marked, so both are skipped.
    assert.equal(again.skipped, 2);
  });

  dbTest("repeating plans come round and stay once-per-day", async () => {
    await reset(db);
    const sat = new Date("2026-08-29T06:00:00Z"); // Saturday
    const sun = new Date("2026-08-30T06:00:00Z");

    await addPlan({
      title: "Take medicine",
      date: "2026-08-29",
      time: "21:00",
      recurrence: "daily",
    });
    await addPlan({
      title: "Call mum",
      date: "2026-08-29",
      recurrence: "weekly",
      recurrenceDays: [0], // Sundays
    });

    // Saturday: only the daily one.
    const saturday = await runReminderSweep(sat, { dryRun: true });
    assert.deepEqual(
      saturday.due.map((d) => d.line.split(" —")[0]),
      ["Take medicine"],
    );
    assert.match(saturday.due[0].line, /every day/);

    // Sunday: both.
    const sunday = await runReminderSweep(sun, { dryRun: true });
    assert.equal(sunday.due.length, 2);
    assert.ok(sunday.due.some((d) => d.line.startsWith("Call mum")));

    // Marked as sent, Saturday goes quiet.
    await markNotified([], saturday.due.map((d) => d.id), "2026-08-29");
    const again = await runReminderSweep(sat, { dryRun: true });
    assert.equal(again.due.length, 0);
    assert.equal(again.skipped, 1);

    // But it comes back the next day — that is the point of a repeat.
    const nextDay = await runReminderSweep(sun, { dryRun: true });
    assert.ok(nextDay.due.some((d) => d.line.startsWith("Take medicine")));
  });

  dbTest("a repeat with no date given is anchored to today", async () => {
    await reset(db);
    const sat = new Date("2026-08-29T06:00:00Z"); // Saturday

    // Without an anchor a recurrence has nothing to repeat from, and the plan
    // silently becomes an undated task that never fires.
    await addPlan({ title: "Take medicine", time: "21:00", recurrence: "daily" }, sat);

    const listed = await listPlans(7, sat);
    const medicine = listed.find((p) => p.title === "Take medicine");

    assert.equal(medicine?.daysAway, 0, "should land today");
    assert.equal(medicine?.repeats, "every day");
    assert.match(medicine!.when!, /21:00/);

    // And it actually fires.
    const swept = await runReminderSweep(sat, { dryRun: true });
    assert.ok(swept.due.some((d) => d.line.startsWith("Take medicine")));
  });

  dbTest("a repeating plan is listed on the day it next lands", async () => {
    await reset(db);
    const sat = new Date("2026-08-29T06:00:00Z");

    // Started in January, so a naive listing would still say "1 Jan".
    await addPlan({ title: "Pay rent", date: "2026-01-01", recurrence: "monthly" });
    await addPlan({ title: "Someday project" });

    const listed = await listPlans(7, sat);

    const rent = listed.find((p) => p.title === "Pay rent");
    assert.equal(rent?.daysAway, 3); // 1 September
    assert.match(rent!.when!, /1 Sept/);
    assert.equal(rent?.repeats, "on the 1st of each month");

    // An undated task is still a task.
    const someday = listed.find((p) => p.title === "Someday project");
    assert.equal(someday?.when, null);
    assert.equal(someday?.repeats, null);
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
