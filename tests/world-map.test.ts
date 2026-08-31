import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP_HEIGHT, MAP_WIDTH, pointInBox, project } from "@/lib/map/world";

/**
 * Turning a click into a coordinate when the map is letterboxed.
 *
 * The panel is no longer a fixed shape — it shares a column and takes whatever
 * height is left — so the SVG scales to fit and centres itself. Every click
 * therefore has to be corrected for bars the layout put around the map, and
 * getting that wrong misplaces the marker by an amount that varies with the
 * panel's proportions, which is to say subtly and never the same way twice.
 */

/** The five cities the map is checked against elsewhere. */
const CITIES = [
  { name: "Yangon", latitude: 16.84, longitude: 96.17 },
  { name: "London", latitude: 51.51, longitude: -0.13 },
  { name: "New York", latitude: 40.71, longitude: -74.01 },
  { name: "Tokyo", latitude: 35.68, longitude: 139.69 },
  { name: "Sydney", latitude: -33.87, longitude: 151.21 },
];

test("a box at the map's own ratio needs no correction", () => {
  // 720x360 is exactly 2:1, so the scale is 2 and there are no bars.
  const centre = pointInBox(720, 360, 360, 180);
  assert.deepEqual(centre, { latitude: 0, longitude: 0 });
});

test("a click round-trips through a box of any shape", () => {
  // Three very different panels: wide and short, near-square, tall and narrow.
  for (const [w, h] of [
    [720, 360],
    [600, 500],
    [320, 700],
  ]) {
    const scale = Math.min(w / MAP_WIDTH, h / MAP_HEIGHT);
    const padX = (w - MAP_WIDTH * scale) / 2;
    const padY = (h - MAP_HEIGHT * scale) / 2;

    for (const city of CITIES) {
      const { x, y } = project(city.latitude, city.longitude);
      const point = pointInBox(w, h, x * scale + padX, y * scale + padY);

      assert.ok(point, `${city.name} in ${w}x${h} fell outside the map`);
      assert.equal(point.latitude, city.latitude, `${city.name} latitude in ${w}x${h}`);
      assert.equal(point.longitude, city.longitude, `${city.name} longitude in ${w}x${h}`);
    }
  }
});

test("a square panel is the case the old maths got wrong", () => {
  /**
   * In a 400x400 box the map is drawn 400 wide and 200 tall, with 100px of
   * empty space above and below. The centre of the *box* is still the centre
   * of the map, but a click a quarter of the way down the box is not a quarter
   * of the way down the world — it is the equator. Scaling by the element's
   * own height would have called it 45°N.
   */
  assert.deepEqual(pointInBox(400, 400, 200, 200), { latitude: 0, longitude: 0 });

  const quarterDown = pointInBox(400, 400, 200, 150);
  assert.ok(quarterDown);
  assert.equal(quarterDown.latitude, 45);
});

test("a click in the letterbox is not a click on the Earth", () => {
  // 100px of bar above and below in a 400x400 box.
  assert.equal(pointInBox(400, 400, 200, 40), null);
  assert.equal(pointInBox(400, 400, 200, 360), null);

  // And the very edge of the drawn area still counts as the map.
  assert.deepEqual(pointInBox(400, 400, 200, 100), { latitude: 90, longitude: 0 });
  assert.deepEqual(pointInBox(400, 400, 200, 300), { latitude: -90, longitude: 0 });
});

test("bars appear on the sides when the box is tall and narrow", () => {
  // 200x400: the map is drawn 200x100, centred, with 150px above and below.
  const middle = pointInBox(200, 400, 100, 200);
  assert.deepEqual(middle, { latitude: 0, longitude: 0 });

  assert.equal(pointInBox(200, 400, 100, 40), null);
});

test("the corners of the world are reachable", () => {
  assert.deepEqual(pointInBox(720, 360, 0, 0), {
    latitude: 90,
    longitude: -180,
  });
  assert.deepEqual(pointInBox(720, 360, 720, 360), {
    latitude: -90,
    longitude: 180,
  });
});

test("a box with no size yields nothing rather than NaN", () => {
  // What `getBoundingClientRect` returns for a panel that is still collapsed,
  // or one rendered inside a display:none ancestor.
  assert.equal(pointInBox(0, 0, 0, 0), null);
  assert.equal(pointInBox(720, 0, 10, 10), null);
  assert.equal(pointInBox(0, 360, 10, 10), null);
});

test("the map's own constants stay in the ratio the projection assumes", () => {
  // One SVG unit is one degree; if that ever stops being true, `unproject`
  // becomes subtraction against the wrong origin and every reading shifts.
  assert.equal(MAP_WIDTH, 360);
  assert.equal(MAP_HEIGHT, 180);
});
