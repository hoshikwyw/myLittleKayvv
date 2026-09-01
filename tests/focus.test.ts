import { test } from "node:test";
import assert from "node:assert/strict";
import { focusFromToolResult } from "@/lib/agent/focus";

/**
 * Pointing the map at whatever was just talked about.
 *
 * Each tool is read by name rather than by hunting the result for anything
 * latitude-shaped. That is the whole design decision under test: guessing
 * would move the map to whatever number happened to look like a coordinate,
 * and would break silently the day a tool's shape changed.
 */

test("a weather answer points at the place it was about", () => {
  const focus = focusFromToolResult("weather_at", {
    found: true,
    place: "Reykjavik, Capital Region, Iceland",
    coordinates: "64.14,-21.90",
    localTime: "05:27",
  });

  assert.deepEqual(focus, {
    latitude: 64.14,
    longitude: -21.9,
    label: "Reykjavik, Capital Region, Iceland",
  });
});

test("a weather answer that found nowhere leaves the map alone", () => {
  // `found: false` means the name never resolved. Moving the map to nothing
  // would be worse than not moving it.
  assert.equal(
    focusFromToolResult("weather_at", {
      found: false,
      note: 'No place called "Nowhereton" was found.',
    }),
    null,
  );
});

test("a place search points at the nearest result", () => {
  // The first is the nearest, and the one the answer is about. Pointing at the
  // fifth would show somewhere the reply never mentioned.
  const focus = focusFromToolResult("find_places", {
    found: 3,
    places: [
      { name: "San Htaik Htar tea shop", coordinates: "16.85021,96.17840" },
      { name: "Mahar Yangon Teashop", coordinates: "16.86000,96.19000" },
    ],
  });

  assert.equal(focus?.label, "San Htaik Htar tea shop");
  assert.equal(focus?.latitude, 16.85021);
});

test("a search that found nothing leaves the map alone", () => {
  assert.equal(
    focusFromToolResult("find_places", { found: 0, places: [], note: "..." }),
    null,
  );
});

test("a tool with no place in it is ignored", () => {
  // The point of matching on the name: `calculate` returning 96.17 is a number,
  // not a longitude, and nothing should move.
  assert.equal(focusFromToolResult("calculate", { value: 96.17 }), null);
  assert.equal(
    focusFromToolResult("get_current_datetime", { date: "2026-09-01" }),
    null,
  );
  assert.equal(
    focusFromToolResult("recall", [{ content: "Nandar is allergic to peanuts" }]),
    null,
  );
});

test("a malformed coordinate does not become a marker", () => {
  for (const coordinates of [
    "not,coordinates",
    "16.84",
    "16.84,96.17,30",
    "",
    "91,0",
    "0,181",
    undefined,
  ]) {
    assert.equal(
      focusFromToolResult("weather_at", { found: true, place: "x", coordinates }),
      null,
      `accepted ${String(coordinates)}`,
    );
  }
});

test("a place with no name still moves the map", () => {
  // The coordinate is the part that matters; a missing name gets a plain one
  // rather than losing the marker.
  const focus = focusFromToolResult("find_places", {
    found: 1,
    places: [{ coordinates: "16.80,96.15" }],
  });

  assert.equal(focus?.label, "that place");
  assert.equal(focus?.latitude, 16.8);
});

test("a failed tool result cannot move the map", () => {
  // The loop only reads a focus from a successful call, but the shape a
  // failure takes should be inert here too.
  assert.equal(
    focusFromToolResult("weather_at", { error: "boom", failed: true }),
    null,
  );
  assert.equal(focusFromToolResult("find_places", null), null);
  assert.equal(focusFromToolResult("find_places", "a string"), null);
});
