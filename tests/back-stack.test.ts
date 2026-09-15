import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  backDepth,
  handleBack,
  registerBack,
  resetBackStack,
} from "../src/lib/native/back-stack";

beforeEach(() => resetBackStack());

test("back with nothing open reports false, so the app minimises", () => {
  assert.equal(handleBack(), false);
});

test("back closes the most recently opened thing first", () => {
  const closed: string[] = [];
  registerBack(() => closed.push("panel"));
  registerBack(() => closed.push("history"));

  assert.equal(handleBack(), true);
  assert.deepEqual(closed, ["history"]);

  assert.equal(handleBack(), true);
  assert.deepEqual(closed, ["history", "panel"]);

  assert.equal(handleBack(), false);
});

test("something closed another way no longer swallows a press of back", () => {
  const closed: string[] = [];
  registerBack(() => closed.push("panel"));
  const unregister = registerBack(() => closed.push("history"));

  // Closed with Escape or a click outside.
  unregister();

  assert.equal(handleBack(), true);
  assert.deepEqual(closed, ["panel"]);
});

test("unregistering after back already closed it is harmless", () => {
  const closed: string[] = [];
  registerBack(() => closed.push("panel"));
  const unregister = registerBack(() => closed.push("history"));

  handleBack();
  // The component's cleanup runs once its state says closed.
  unregister();

  assert.equal(backDepth(), 1);
  handleBack();
  assert.deepEqual(closed, ["history", "panel"]);
});

test("unregistering twice removes only its own entry", () => {
  const close = () => {};
  const first = registerBack(close);
  registerBack(close);

  first();
  first();

  assert.equal(backDepth(), 1);
});
