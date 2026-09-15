import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIGEST_HOUR,
  PLAN_GRACE_MINUTES,
  PLAN_LEAD_MINUTES,
  describeLead,
  selectDuePlans,
  wallClock,
  type PlanCandidate,
} from "@/lib/reminders/plans";

/**
 * When a plan is reminded about.
 *
 * The rule used to be "does it land today?", asked once at 06:30. A plan at
 * 19:30 was only ever mentioned that morning, and one added at noon for the
 * same evening was never mentioned at all. These tests hold the replacement:
 * a timed plan is reminded near its time; an all-day one goes in the digest.
 *
 * Yangon is UTC+6:30 with no daylight saving, which makes the arithmetic here
 * easy to check by hand.
 */

const TZ = "Asia/Yangon";

/** A moment given as Yangon wall-clock time, so the tests read naturally. */
function yangon(iso: string): Date {
  return new Date(`${iso}:00+06:30`);
}

function plan(overrides: Partial<PlanCandidate>): PlanCandidate {
  return {
    id: overrides.title ?? "p",
    title: "Study",
    location: null,
    startsAt: yangon("2026-09-14T19:30"),
    allDay: false,
    recurrence: "none",
    recurrenceDays: [],
    lastNotifiedOn: null,
    ...overrides,
  };
}

test("the reported bug: a plan added at noon for that evening is reminded", () => {
  /**
   * Exactly what happened. "Study" at 19:30 and "Go to bed" at 23:00 were both
   * created at 11:58 on the 14th — after that morning's only sweep — and were
   * never sent. The next sweep ran on the 15th, when both were yesterday's.
   */
  const study = plan({ title: "Study", startsAt: yangon("2026-09-14T19:30") });
  const bed = plan({ title: "Go to bed", startsAt: yangon("2026-09-14T23:00") });

  const atSeven = selectDuePlans([study, bed], yangon("2026-09-14T19:20"), TZ);
  assert.deepEqual(atSeven.timed.map((p) => p.id), ["Study"]);

  const atEleven = selectDuePlans([study, bed], yangon("2026-09-14T22:50"), TZ);
  assert.deepEqual(atEleven.timed.map((p) => p.id), ["Go to bed"]);
});

test("a timed plan is not announced hours early", () => {
  // The old behaviour: mentioned at 06:30 for something at 19:30.
  const early = selectDuePlans([plan({})], yangon("2026-09-14T06:30"), TZ);
  assert.equal(early.timed.length, 0);
  assert.equal(early.allDay.length, 0);
});

test("the reminder window opens the lead time before and closes after grace", () => {
  const start = yangon("2026-09-14T19:30");
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
  const due = (minutes: number) =>
    selectDuePlans([plan({ startsAt: start })], at(minutes), TZ).timed.length === 1;

  assert.equal(due(-PLAN_LEAD_MINUTES - 1), false, "too early");
  assert.equal(due(-PLAN_LEAD_MINUTES), true, "window opens");
  assert.equal(due(0), true, "at the moment it starts");
  assert.equal(due(PLAN_GRACE_MINUTES), true, "a late run still sends");
  assert.equal(due(PLAN_GRACE_MINUTES + 1), false, "over and done");
});

test("a scheduler that runs every fifteen minutes cannot miss a plan", () => {
  /**
   * The lead time is chosen to match the run interval. Whatever minute a plan
   * starts on, some run in a fifteen-minute cadence lands inside its window —
   * checked here for every minute of an hour rather than assumed.
   */
  for (let startMinute = 0; startMinute < 60; startMinute++) {
    const start = yangon(`2026-09-14T19:${String(startMinute).padStart(2, "0")}`);
    const runs = [0, 15, 30, 45, 60, 75].map((m) => yangon(`2026-09-14T19:00`).getTime() + m * 60_000);

    const caught = runs.some(
      (run) => selectDuePlans([plan({ startsAt: start })], new Date(run), TZ).timed.length === 1,
    );
    assert.ok(caught, `a plan at 19:${startMinute} was missed`);
  }
});

test("a reminder is sent once, not every run inside the window", () => {
  const study = plan({ lastNotifiedOn: "2026-09-14" });

  const result = selectDuePlans([study], yangon("2026-09-14T19:25"), TZ);
  assert.equal(result.timed.length, 0);
  assert.equal(result.skipped, 1);
});

test("a daily plan comes back tomorrow despite being marked today", () => {
  // The mark is per occurrence, so yesterday's does not silence today's.
  const medicine = plan({
    title: "Take medicine",
    startsAt: yangon("2026-09-14T21:00"),
    recurrence: "daily",
    lastNotifiedOn: "2026-09-14",
  });

  const tomorrow = selectDuePlans([medicine], yangon("2026-09-15T20:50"), TZ);
  assert.equal(tomorrow.timed.length, 1);
  assert.equal(tomorrow.timed[0].occurrenceIso, "2026-09-15");
  assert.match(tomorrow.timed[0].line, /every day/);
});

test("a weekly plan fires only on its day", () => {
  const gym = plan({
    title: "Gym",
    startsAt: yangon("2026-09-14T18:00"), // a Monday
    recurrence: "weekly",
    recurrenceDays: [1],
  });

  assert.equal(selectDuePlans([gym], yangon("2026-09-21T17:50"), TZ).timed.length, 1, "next Monday");
  assert.equal(selectDuePlans([gym], yangon("2026-09-22T17:50"), TZ).timed.length, 0, "Tuesday");
});

test("a plan just after midnight is reminded the evening before, and marked for its own day", () => {
  /**
   * The window crosses midnight. Marking today's date would leave tomorrow's
   * occurrence unmarked, and it would be sent again once the date rolled over.
   */
  const early = plan({ title: "Flight", startsAt: yangon("2026-09-15T00:05") });

  const result = selectDuePlans([early], yangon("2026-09-14T23:55"), TZ);
  assert.equal(result.timed.length, 1);
  assert.equal(result.timed[0].occurrenceIso, "2026-09-15");
});

test("a plan just before midnight still sends inside its grace after midnight", () => {
  const late = plan({ title: "Call", startsAt: yangon("2026-09-14T23:55") });

  const result = selectDuePlans([late], yangon("2026-09-15T00:10"), TZ);
  assert.equal(result.timed.length, 1);
  assert.equal(result.timed[0].occurrenceIso, "2026-09-14");
});

test("a plan already long past is not sent late", () => {
  // Yesterday's "Study" is not a reminder anyone can act on.
  const result = selectDuePlans([plan({})], yangon("2026-09-15T09:00"), TZ);
  assert.equal(result.timed.length, 0);
});

test("an all-day plan waits for the morning digest", () => {
  const errand = plan({
    title: "Pay rent",
    startsAt: yangon("2026-09-14T12:00"),
    allDay: true,
  });

  const beforeDigest = selectDuePlans([errand], yangon("2026-09-14T00:10"), TZ);
  assert.equal(beforeDigest.allDay.length, 0, "not at a minute past midnight");

  const morning = selectDuePlans(
    [errand],
    yangon(`2026-09-14T0${DIGEST_HOUR}:00`),
    TZ,
  );
  assert.equal(morning.allDay.length, 1);
  assert.equal(morning.timed.length, 0);
});

test("Vercel's own daily run at 06:30 still delivers the digest as a backup", () => {
  // 00:00 UTC is 06:30 in Yangon. If the external scheduler ever stops, the
  // birthdays and all-day plans must still go out.
  const errand = plan({ startsAt: yangon("2026-09-14T12:00"), allDay: true });
  const result = selectDuePlans([errand], new Date("2026-09-14T00:00:00Z"), TZ);
  assert.equal(result.allDay.length, 1);
});

test("an undated plan is a task, never a reminder", () => {
  const result = selectDuePlans(
    [plan({ startsAt: null })],
    yangon("2026-09-14T19:30"),
    TZ,
  );
  assert.equal(result.timed.length + result.allDay.length, 0);
});

test("the line says when, and how soon", () => {
  const result = selectDuePlans(
    [plan({ location: "Library" })],
    yangon("2026-09-14T19:18"),
    TZ,
  );
  assert.equal(result.timed[0].line, "Study — 19:30, in 12 minutes, Library.");
});

test("several plans come back soonest first", () => {
  const result = selectDuePlans(
    [
      plan({ title: "Later", startsAt: yangon("2026-09-14T19:40") }),
      plan({ title: "Sooner", startsAt: yangon("2026-09-14T19:30") }),
    ],
    yangon("2026-09-14T19:28"),
    TZ,
  );
  assert.deepEqual(result.timed.map((p) => p.id), ["Sooner", "Later"]);
});

test("the relative time reads as a person would say it", () => {
  assert.equal(describeLead(12), "in 12 minutes");
  assert.equal(describeLead(1), "in 1 minute");
  assert.equal(describeLead(0), "now");
  assert.equal(describeLead(-0.6), "now");
  assert.equal(describeLead(-8), "started 8 minutes ago");
});

test("the wall clock is read in the owner's timezone, not the server's", () => {
  // Vercel runs in UTC. Reading hours off the Date directly would put every
  // Yangon reminder six and a half hours out.
  assert.deepEqual(wallClock(new Date("2026-09-14T13:00:00Z"), TZ), {
    hour: 19,
    minute: 30,
  });
});
