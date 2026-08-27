import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  isLeapYear,
  todayIn,
  upcomingTargets,
  yearsOnNextOccurrence,
  zonedTimeToUtc,
} from "@/lib/memory/calendar";

test("today is read in the given timezone, not the server's", () => {
  // 20:00 UTC is already the next day in Yangon (UTC+6:30).
  assert.deepEqual(todayIn("Asia/Yangon", new Date("2026-08-24T20:00:00Z")), {
    year: 2026,
    month: 8,
    day: 25,
  });
  assert.deepEqual(todayIn("UTC", new Date("2026-08-24T20:00:00Z")), {
    year: 2026,
    month: 8,
    day: 24,
  });
});

test("leap years follow the full rule, not just divisible by four", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2027), false);
  assert.equal(isLeapYear(2100), false); // century, not divisible by 400
  assert.equal(isLeapYear(2000), true);
});

test("adding days crosses months and years", () => {
  assert.deepEqual(addDays({ year: 2026, month: 8, day: 31 }, 1), {
    year: 2026,
    month: 9,
    day: 1,
  });
  assert.deepEqual(addDays({ year: 2026, month: 12, day: 31 }, 1), {
    year: 2027,
    month: 1,
    day: 1,
  });
  assert.deepEqual(addDays({ year: 2026, month: 1, day: 1 }, -1), {
    year: 2025,
    month: 12,
    day: 31,
  });
});

test("a 29 February birthday is observed on 1 March in a non-leap year", () => {
  const nonLeap = upcomingTargets({ year: 2027, month: 2, day: 27 }, 3);
  assert.ok(nonLeap.some((t) => t.month === 2 && t.day === 29));

  // In a leap year it appears exactly once, on its own.
  const leap = upcomingTargets({ year: 2028, month: 2, day: 27 }, 3);
  assert.equal(leap.filter((t) => t.month === 2 && t.day === 29).length, 1);
});

test("age on next occurrence accounts for whether the date has passed", () => {
  const today = { year: 2026, month: 8, day: 24 };
  // Still ahead this year.
  assert.equal(yearsOnNextOccurrence({ month: 12, day: 25, year: 1998 }, today), 28);
  // Already gone, so it counts to next year's.
  assert.equal(yearsOnNextOccurrence({ month: 3, day: 3, year: 1998 }, today), 29);
  assert.equal(yearsOnNextOccurrence({ month: 3, day: 3, year: null }, today), null);
});

test("wall-clock times convert through the owner's timezone", () => {
  // Yangon is UTC+6:30 with no DST.
  assert.equal(
    zonedTimeToUtc(2026, 8, 24, 15, 0, "Asia/Yangon").toISOString(),
    "2026-08-24T08:30:00.000Z",
  );
  assert.equal(
    zonedTimeToUtc(2026, 8, 24, 0, 0, "Asia/Yangon").toISOString(),
    "2026-08-23T17:30:00.000Z",
  );
  assert.equal(
    zonedTimeToUtc(2026, 8, 24, 15, 0, "UTC").toISOString(),
    "2026-08-24T15:00:00.000Z",
  );
  assert.equal(
    zonedTimeToUtc(2026, 8, 24, 15, 0, "Asia/Seoul").toISOString(),
    "2026-08-24T06:00:00.000Z",
  );
});

test("DST is handled on both sides of the year", () => {
  assert.equal(
    zonedTimeToUtc(2026, 7, 15, 12, 0, "America/New_York").toISOString(),
    "2026-07-15T16:00:00.000Z", // EDT, UTC-4
  );
  assert.equal(
    zonedTimeToUtc(2026, 1, 15, 12, 0, "America/New_York").toISOString(),
    "2026-01-15T17:00:00.000Z", // EST, UTC-5
  );
});

test("a late-night local time round-trips to the same calendar day", () => {
  const instant = zonedTimeToUtc(2026, 8, 24, 23, 30, "Asia/Yangon");
  assert.deepEqual(todayIn("Asia/Yangon", instant), {
    year: 2026,
    month: 8,
    day: 24,
  });
});
