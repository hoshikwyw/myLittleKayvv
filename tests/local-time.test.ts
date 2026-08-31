import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeDifference,
  isDaylight,
  offsetMinutesAt,
  placeTime,
  zoneAt,
} from "@/lib/map/local-time";

test("a coordinate resolves to its zone", () => {
  assert.equal(zoneAt(16.84, 96.17), "Asia/Yangon");
  assert.equal(zoneAt(51.51, -0.13), "Europe/London");
  assert.equal(zoneAt(-33.87, 151.21), "Australia/Sydney");
});

test("open ocean still answers, rather than failing", () => {
  // A click that misses land must not break the panel.
  assert.match(zoneAt(0, -140), /^Etc\/GMT/);
  assert.ok(zoneAt(-60, -30).length > 0);
});

test("offsets account for DST", () => {
  const summer = new Date("2026-07-15T12:00:00Z");
  const winter = new Date("2026-01-15T12:00:00Z");

  assert.equal(offsetMinutesAt("Europe/London", summer), 60); // BST
  assert.equal(offsetMinutesAt("Europe/London", winter), 0); // GMT

  // Yangon has no DST, and a half-hour offset that catches naive code out.
  assert.equal(offsetMinutesAt("Asia/Yangon", summer), 390);
  assert.equal(offsetMinutesAt("Asia/Yangon", winter), 390);
});

test("the difference reads as a person would say it", () => {
  assert.equal(describeDifference(0), "same time as you");
  assert.equal(describeDifference(60), "1 hour ahead of you");
  assert.equal(describeDifference(-150), "2 hours 30 minutes behind you");
  assert.equal(describeDifference(30), "30 minutes ahead of you");
});

test("daylight follows the sun, not the clock", () => {
  // Midday and midnight in Yangon, as instants.
  assert.equal(isDaylight(16.84, 96.17, new Date("2026-06-21T05:30:00Z")), true);
  assert.equal(isDaylight(16.84, 96.17, new Date("2026-06-21T17:30:00Z")), false);
});

test("polar day and polar night are handled", () => {
  // The reason this is a solar calculation rather than "is it between six and
  // six": in June the sun does not set in northern Norway, and does not rise
  // in Antarctica.
  const june = new Date("2026-06-21T00:00:00Z");
  assert.equal(isDaylight(78.9, 11.9, june), true); // Svalbard, local midnight
  assert.equal(isDaylight(-77.8, 166.7, june), false); // McMurdo, polar night

  const december = new Date("2026-12-21T12:00:00Z");
  assert.equal(isDaylight(78.9, 11.9, december), false); // Svalbard, dark at noon
});

test("a place reads back complete", () => {
  const at = new Date("2026-08-31T06:00:00Z");
  const yangon = placeTime(16.84, 96.17, "Asia/Yangon", at);

  assert.equal(yangon.zone, "Asia/Yangon");
  assert.equal(yangon.time, "12:30");
  assert.match(yangon.date, /31 August/);
  assert.equal(yangon.offsetMinutes, 390);
  assert.equal(yangon.relative, "same time as you");
  assert.equal(yangon.daylight, true);

  // Somewhere far from home, seen from Yangon.
  const newYork = placeTime(40.71, -74.01, "Asia/Yangon", at);
  assert.equal(newYork.zone, "America/New_York");
  assert.match(newYork.relative, /behind you/);
  assert.equal(newYork.daylight, false); // 02:00 local
});
