import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeRecurrence,
  planOccursOn,
  weekdayOf,
  type RecurringPlan,
} from "@/lib/memory/recurrence";

/** Saturday 29 August 2026. */
const start = { year: 2026, month: 8, day: 29 };
const plan = (over: Partial<RecurringPlan> = {}): RecurringPlan => ({
  start,
  recurrence: "none",
  recurrenceDays: [],
  ...over,
});

test("weekday is computed without timezone interference", () => {
  assert.equal(weekdayOf({ year: 2026, month: 8, day: 29 }), 6); // Saturday
  assert.equal(weekdayOf({ year: 2026, month: 8, day: 30 }), 0); // Sunday
});

test("a one-off falls only on its own day", () => {
  const p = plan();
  assert.equal(planOccursOn(p, start), true);
  assert.equal(planOccursOn(p, { year: 2026, month: 8, day: 30 }), false);
});

test("nothing fires before it starts", () => {
  // "Every Tuesday" said on a Wednesday means next Tuesday, not retroactively.
  for (const recurrence of ["daily", "weekly", "monthly", "yearly"] as const) {
    assert.equal(
      planOccursOn(plan({ recurrence }), { year: 2026, month: 8, day: 28 }),
      false,
      recurrence,
    );
  }
});

test("daily fires every day from the start", () => {
  const p = plan({ recurrence: "daily" });
  assert.equal(planOccursOn(p, start), true);
  assert.equal(planOccursOn(p, { year: 2026, month: 9, day: 15 }), true);
  assert.equal(planOccursOn(p, { year: 2027, month: 1, day: 1 }), true);
});

test("weekly with no days named repeats on the day it started", () => {
  const p = plan({ recurrence: "weekly" }); // started a Saturday
  assert.equal(planOccursOn(p, { year: 2026, month: 9, day: 5 }), true); // Sat
  assert.equal(planOccursOn(p, { year: 2026, month: 9, day: 6 }), false); // Sun
});

test("weekly honours named days", () => {
  // Sundays and Wednesdays.
  const p = plan({ recurrence: "weekly", recurrenceDays: [0, 3] });
  assert.equal(planOccursOn(p, { year: 2026, month: 8, day: 30 }), true); // Sun
  assert.equal(planOccursOn(p, { year: 2026, month: 9, day: 2 }), true); // Wed
  assert.equal(planOccursOn(p, { year: 2026, month: 9, day: 3 }), false); // Thu
});

test("monthly on the 31st still lands in a short month", () => {
  // Rent on the 31st is still due in November and February.
  const p = plan({ start: { year: 2026, month: 1, day: 31 }, recurrence: "monthly" });
  assert.equal(planOccursOn(p, { year: 2026, month: 3, day: 31 }), true);
  assert.equal(planOccursOn(p, { year: 2026, month: 4, day: 30 }), true); // clamped
  assert.equal(planOccursOn(p, { year: 2026, month: 4, day: 29 }), false);
  assert.equal(planOccursOn(p, { year: 2026, month: 2, day: 28 }), true); // clamped
});

test("yearly repeats on the same date", () => {
  const p = plan({ recurrence: "yearly" });
  assert.equal(planOccursOn(p, { year: 2027, month: 8, day: 29 }), true);
  assert.equal(planOccursOn(p, { year: 2027, month: 8, day: 28 }), false);
  assert.equal(planOccursOn(p, { year: 2027, month: 9, day: 29 }), false);
});

test("a 29 February yearly plan is observed on the 28th in a common year", () => {
  const p = plan({ start: { year: 2024, month: 2, day: 29 }, recurrence: "yearly" });
  assert.equal(planOccursOn(p, { year: 2028, month: 2, day: 29 }), true); // leap
  assert.equal(planOccursOn(p, { year: 2027, month: 2, day: 28 }), true); // clamped
});

test("repetition reads as a person would say it", () => {
  assert.equal(describeRecurrence(plan()), null);
  assert.equal(describeRecurrence(plan({ recurrence: "daily" })), "every day");
  assert.equal(
    describeRecurrence(plan({ recurrence: "weekly" })),
    "every Saturday",
  );
  assert.equal(
    describeRecurrence(plan({ recurrence: "weekly", recurrenceDays: [1, 3, 5] })),
    "every Monday, Wednesday and Friday",
  );
  assert.equal(
    describeRecurrence(plan({ start: { year: 2026, month: 1, day: 1 }, recurrence: "monthly" })),
    "on the 1st of each month",
  );
  assert.equal(
    describeRecurrence(plan({ start: { year: 2026, month: 1, day: 22 }, recurrence: "monthly" })),
    "on the 22nd of each month",
  );
  // 11th, 12th, 13th break the usual pattern.
  assert.equal(
    describeRecurrence(plan({ start: { year: 2026, month: 1, day: 11 }, recurrence: "monthly" })),
    "on the 11th of each month",
  );
});
