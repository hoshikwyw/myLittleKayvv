import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDueDates, type DateCandidate } from "@/lib/reminders/sweep";
import { upcomingTargets } from "@/lib/memory/calendar";

/**
 * The firing rule. This decides whether an anniversary is remembered or
 * missed, which makes it the most important logic in the project.
 */

const today = { year: 2026, month: 8, day: 24 };
const todayIso = "2026-08-24";
const map = new Map(
  upcomingTargets(today, 90).map((t) => [`${t.month}-${t.day}`, t.daysAway]),
);

const base: Omit<DateCandidate, "month" | "day"> = {
  id: "x",
  label: "Birthday",
  kind: "birthday",
  year: null,
  recurring: true,
  remindDaysBefore: [7, 1, 0],
  lastNotifiedOn: null,
  personName: "Nandar",
};

const run = (rows: DateCandidate[]) =>
  selectDueDates(rows, today, todayIso, map);

test("fires on the day, the day before, and a week before", () => {
  assert.deepEqual(
    run([{ ...base, month: 8, day: 24 }]).due.map((d) => d.line),
    ["Nandar's Birthday is today."],
  );
  assert.deepEqual(
    run([{ ...base, month: 8, day: 25 }]).due.map((d) => d.line),
    ["Nandar's Birthday is tomorrow (25 August)."],
  );
  assert.deepEqual(
    run([{ ...base, month: 8, day: 31 }]).due.map((d) => d.line),
    ["Nandar's Birthday is in 7 days (31 August)."],
  );
});

test("stays silent on days it was not asked to fire", () => {
  assert.equal(run([{ ...base, month: 8, day: 27 }]).due.length, 0);
  assert.equal(run([{ ...base, month: 12, day: 25 }]).due.length, 0);
});

test("honours a custom lead time", () => {
  assert.deepEqual(
    run([{ ...base, month: 8, day: 27, remindDaysBefore: [3] }]).due.map(
      (d) => d.daysAway,
    ),
    [3],
  );
});

test("does not send twice in one day", () => {
  // Vercel Cron guarantees the hour, not the minute, and may retry.
  const already = run([
    { ...base, month: 8, day: 24, lastNotifiedOn: "2026-08-24" },
  ]);
  assert.equal(already.due.length, 0);
  assert.equal(already.skipped, 1);

  const yesterday = run([
    { ...base, month: 8, day: 24, lastNotifiedOn: "2026-08-23" },
  ]);
  assert.equal(yesterday.due.length, 1);
});

test("reports the age when the year is known", () => {
  assert.deepEqual(
    run([{ ...base, month: 8, day: 24, year: 1998 }]).due.map((d) => d.line),
    ["Nandar's Birthday is today — turning 28."],
  );
});

test("a one-off date does not recur forever", () => {
  assert.equal(
    run([{ ...base, month: 8, day: 24, year: 2020, recurring: false }]).due.length,
    0,
  );
  assert.equal(
    run([{ ...base, month: 8, day: 24, year: 2026, recurring: false }]).due.length,
    1,
  );
});

test("a date with no person attached still reads naturally", () => {
  assert.deepEqual(
    run([
      {
        ...base,
        month: 8,
        day: 24,
        personName: null,
        label: "Visa renewal",
        kind: "custom",
      },
    ]).due.map((d) => d.line),
    ["Visa renewal is today."],
  );
});

test("an anniversary is not described as turning an age", () => {
  // A person turns 28; a marriage does not.
  assert.deepEqual(
    run([
      {
        ...base,
        month: 8,
        day: 24,
        year: 2021,
        label: "Wedding anniversary",
        kind: "anniversary",
        personName: "Su",
      },
    ]).due.map((d) => d.line),
    ["Su's Wedding anniversary is today — 5 years."],
  );
});

test("a leap birthday still fires in a non-leap year", () => {
  const feb = { year: 2027, month: 2, day: 28 };
  const febMap = new Map(
    upcomingTargets(feb, 90).map((t) => [`${t.month}-${t.day}`, t.daysAway]),
  );
  assert.equal(
    selectDueDates([{ ...base, month: 2, day: 29 }], feb, "2027-02-28", febMap)
      .due.length,
    1,
  );
});
