import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHomeLocation } from "@/lib/map/home";

/**
 * One parser for HOME_LOCATION, because there were two — the places tool read
 * it one way and the weather tool another, which is how they end up
 * disagreeing about where the user lives.
 */

test("the ordinary form parses", () => {
  assert.deepEqual(parseHomeLocation("16.8409,96.1735"), {
    latitude: 16.8409,
    longitude: 96.1735,
  });

  // Whitespace and negatives are both normal in a hand-edited env file.
  assert.deepEqual(parseHomeLocation(" -33.87 , 151.21 "), {
    latitude: -33.87,
    longitude: 151.21,
  });
});

test("an unset home is null, not an error", () => {
  // Perfectly ordinary: the assistant works without one, it just has to ask.
  assert.equal(parseHomeLocation(""), null);
  assert.equal(parseHomeLocation("   "), null);
});

test("a swapped pair is rejected rather than believed", () => {
  // "96.17,16.84" is Yangon written backwards. Taken at face value it is a
  // point in the Arabian Sea, and the weather would be reported without
  // complaint — so the latitude range has to be checked, not assumed.
  assert.equal(parseHomeLocation("96.1735,16.8409"), null);
});

test("malformed values do not become coordinates", () => {
  assert.equal(parseHomeLocation("Yangon"), null);
  assert.equal(parseHomeLocation("16.84"), null);
  assert.equal(parseHomeLocation("16.84,96.17,30"), null);
  assert.equal(parseHomeLocation("16.84,"), null);
  assert.equal(parseHomeLocation("abc,def"), null);

  // Number("") is 0, so an empty half would otherwise parse as the equator.
  assert.equal(parseHomeLocation(",96.17"), null);
});

test("the antimeridian and the poles are inside the range", () => {
  assert.deepEqual(parseHomeLocation("90,180"), { latitude: 90, longitude: 180 });
  assert.deepEqual(parseHomeLocation("-90,-180"), { latitude: -90, longitude: -180 });
  assert.equal(parseHomeLocation("90.1,0"), null);
  assert.equal(parseHomeLocation("0,180.1"), null);
});
