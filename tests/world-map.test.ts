import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  WORLD_VIEW,
  decimalsFor,
  pointInBox,
  project,
  viewAround,
} from "@/lib/map/world";
import {
  STREET_STEP,
  ZOOM_STEPS,
  clampStep,
  stepForDistance,
  viewFor,
} from "@/components/hud/map-zoom";

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

/* ------------------------------------------------------------------------ *
 * Zooming
 * ------------------------------------------------------------------------ */

test("the world view is the whole world", () => {
  assert.deepEqual(WORLD_VIEW, { x: 0, y: 0, width: 360, height: 180 });
});

test("a zoomed view is centred on the point and the right size", () => {
  const view = viewAround(16.84, 96.17, 10);

  // 10km tall, which at 111.32km per degree is 0.0898°.
  assert.ok(Math.abs(view.height - 10 / 111.32) < 1e-9);

  // The centre of the box is the point itself.
  const { x, y } = project(16.84, 96.17);
  assert.ok(Math.abs(view.x + view.width / 2 - x) < 1e-9);
  assert.ok(Math.abs(view.y + view.height / 2 - y) < 1e-9);
});

test("longitude is widened so streets are not stretched sideways", () => {
  /**
   * A degree of longitude is shorter than a degree of latitude everywhere but
   * the equator, so an equal span in degrees is not an equal span on the
   * ground. Without the correction a street grid comes out stretched — barely
   * at Yangon, more than twice over at Reykjavik.
   */
  const yangon = viewAround(16.84, 96.17, 10);
  assert.ok(Math.abs(yangon.width / yangon.height - 1 / Math.cos((16.84 * Math.PI) / 180)) < 1e-9);

  const reykjavik = viewAround(64.14, -21.9, 10);
  assert.ok(reykjavik.width / reykjavik.height > 2.2);

  // At the equator there is nothing to correct.
  const equator = viewAround(0, 0, 10);
  assert.ok(Math.abs(equator.width - equator.height) < 1e-9);
});

test("the poles do not produce an infinitely wide view", () => {
  // cos(90°) is zero, and dividing by it would make the width infinite and
  // every path in the view vanish.
  const view = viewAround(89.999, 0, 10);
  assert.ok(Number.isFinite(view.width));
  assert.ok(view.width > 0);
});

test("a click is corrected for the zoom as well as the letterbox", () => {
  /**
   * This is the arithmetic that was silently wrong the moment the map could
   * zoom. Applying only the letterbox correction was right while the view was
   * always the whole world, and became a fixed offset the size of the window
   * as soon as it was not.
   */
  const view = viewAround(16.84, 96.17, 10);

  // Dead centre of a box at the view's own aspect ratio is the centre point.
  const w = 800;
  const h = (w * view.height) / view.width;
  const point = pointInBox(w, h, w / 2, h / 2, view);

  assert.ok(point);
  assert.ok(Math.abs(point.latitude - 16.84) < 1e-6);
  assert.ok(Math.abs(point.longitude - 96.17) < 1e-6);
});

test("a click at the edge of a zoomed view lands at the edge of it", () => {
  const view = viewAround(16.84, 96.17, 10);
  const w = 800;
  const h = (w * view.height) / view.width;

  const topLeft = pointInBox(w, h, 0, 0, view);
  assert.ok(topLeft);

  // Tolerance from the precision the view itself asks for, not a number picked
  // by hand: at this zoom coordinates are rounded to five places, so demanding
  // agreement to six was asking for more than was ever returned.
  const tolerance = 10 ** -decimalsFor(view);

  // The top of the box is the northern edge of the window, not 90°N.
  assert.ok(Math.abs(topLeft.latitude - (16.84 + view.height / 2)) < tolerance);
  assert.ok(Math.abs(topLeft.longitude - (96.17 - view.width / 2)) < tolerance);
});

test("the same click means different things at different zooms", () => {
  // The guard against the whole class of bug: if these agreed, the view would
  // be being ignored.
  const w = 800;
  const h = 400;

  const world = pointInBox(w, h, 600, 100, WORLD_VIEW);
  const near = pointInBox(w, h, 600, 100, viewAround(16.84, 96.17, 10));

  assert.ok(world && near);
  assert.notEqual(world.latitude, near.latitude);
  assert.ok(Math.abs(near.latitude - 16.84) < 0.1);
});

test("zoom steps run widest to narrowest and only fetch streets when close", () => {
  for (let i = 1; i < ZOOM_STEPS.length; i++) {
    const previous = ZOOM_STEPS[i - 1].spanKm;
    // The first step is the world, expressed as 0 rather than 40,000.
    if (previous > 0) assert.ok(ZOOM_STEPS[i].spanKm < previous);
  }

  // Nothing is fetched while the country outline still has something to say.
  assert.equal(ZOOM_STEPS[0].streetRadius, null);
  assert.equal(ZOOM_STEPS[ZOOM_STEPS.length - 1].streetRadius! > 0, true);
});

test("how far away decides how close to look", () => {
  // A pharmacy round the corner and a city on another continent arrive by the
  // same path, and one scale cannot show both.
  assert.equal(stepForDistance(0.47), STREET_STEP);
  assert.equal(stepForDistance(5.3), 5);
  assert.ok(stepForDistance(8000) < stepForDistance(1));

  // Nothing to measure against: assume it is somewhere worth looking at
  // closely, which is what "show me this place" usually means.
  assert.equal(stepForDistance(null), STREET_STEP);
});

test("an out-of-range step is clamped rather than trusted", () => {
  assert.equal(clampStep(-5), 0);
  assert.equal(clampStep(999), ZOOM_STEPS.length - 1);

  // A step with no centre to zoom to is the whole world, not a crash.
  assert.deepEqual(viewFor(STREET_STEP, null), WORLD_VIEW);
  assert.deepEqual(viewFor(0, { latitude: 16.84, longitude: 96.17 }), WORLD_VIEW);
});

test("coordinate precision follows the zoom", () => {
  // Two places is 1.1km — fine for the whole Earth, useless at street level
  // where the entire view is 0.09° tall and every click would round to one of
  // nine values.
  assert.equal(decimalsFor(WORLD_VIEW), 2);
  assert.ok(decimalsFor(viewAround(16.84, 96.17, 10)) >= 5);

  // Never finer than a metre, which is past the accuracy of anything drawn.
  assert.ok(decimalsFor(viewAround(16.84, 96.17, 0.05)) <= 6);
});
