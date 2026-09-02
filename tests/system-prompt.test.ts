import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "@/lib/llm/system-prompt";
import { buildToolRegistry } from "@/lib/agent";
import { MemoryWriteLog } from "@/lib/tools/memory-tools";
import { configured } from "@/lib/env";

/**
 * The prompt is the one place where a rename goes unnoticed: nothing imports
 * the string "weather_at", so renaming the tool would leave the model being
 * told to call something that no longer exists. These tests are the link.
 */

before(() => {
  process.env.TIMEZONE = "Asia/Yangon";
  process.env.OWNER_NAME = "Khaing";
});

const NOW = new Date("2026-08-31T06:00:00Z");

test("without a selected point the prompt says nothing about pointing", () => {
  const prompt = buildSystemPrompt({ now: NOW });

  // Absence has to be meaningful: a permanent "they may have a point selected"
  // would have the model asking about a map nobody is looking at.
  assert.ok(!prompt.includes("Where they are pointing"));
});

test("a selected point is described in hemispheres, not signs", () => {
  const prompt = buildSystemPrompt({
    now: NOW,
    focus: { latitude: 21.17, longitude: 94.86, zone: "Asia/Yangon" },
  });

  assert.match(prompt, /21\.17°N 94\.86°E/);
  assert.match(prompt, /Asia\/Yangon timezone/);
  assert.match(prompt, /"Here", "there", and "this place"/);
});

test("southern and western coordinates lose their minus signs", () => {
  const prompt = buildSystemPrompt({
    now: NOW,
    focus: { latitude: -33.87, longitude: -70.67, zone: "America/Santiago" },
  });

  assert.match(prompt, /33\.87°S 70\.67°W/);
  assert.ok(!prompt.includes("-33.87"));
});

test("the point is framed as a coordinate, not a place to be named", () => {
  // The failure this prevents: the model reads 21.17N 94.86E, decides it is
  // "Mandalay", and answers confidently about a city 100km away.
  const prompt = buildSystemPrompt({
    now: NOW,
    focus: { latitude: 21.17, longitude: 94.86, zone: "Asia/Yangon" },
  });

  assert.match(prompt, /rather than\s+guessing a place name/);
  assert.match(prompt, /not a town/);
});

test("every tool the prompt tells the model to call is registered", () => {
  // Named explicitly rather than scraped out of the backticks: the prompt also
  // quotes field names like `explicit`, and a scrape cannot tell a field from
  // a tool. The point is to fail when a tool is renamed and the prompt is not.
  const ALWAYS = ["weather_at"];
  const NEEDS_DATABASE = [
    "remember_person",
    "remember_date",
    "remember_fact",
    "recall",
    "who_is",
    "what_is_coming_up",
  ];

  const prompt = buildSystemPrompt({
    now: NOW,
    focus: { latitude: 0, longitude: 0, zone: "Etc/GMT" },
    memoryAvailable: true,
  });

  for (const name of [...ALWAYS, ...NEEDS_DATABASE]) {
    assert.ok(prompt.includes(`\`${name}\``), `prompt no longer names "${name}"`);
  }

  const registry = buildToolRegistry(new MemoryWriteLog());

  for (const name of ALWAYS) {
    assert.ok(registry.has(name), `prompt names "${name}", which is not registered`);
  }

  // The memory tools only exist when there is a database to write to, which is
  // the whole reason `memoryAvailable` is a separate flag on the prompt.
  if (configured.database()) {
    for (const name of NEEDS_DATABASE) {
      assert.ok(registry.has(name), `prompt names "${name}", which is not registered`);
    }
  }
});

test("with memory offline the prompt stops naming memory tools", () => {
  const prompt = buildSystemPrompt({ now: NOW, memoryAvailable: false });

  // Otherwise the model is told to call tools it has not been given, and
  // answers "I'll remember that" while nothing is stored.
  assert.ok(!prompt.includes("remember_person"));
  assert.match(prompt, /Memory is offline/);
});

test("a Telegram reply is not told there is a map on screen", () => {
  /**
   * On a phone the reply *is* the delivery. Told about a map beside the
   * conversation, the model announces it has marked something the reader
   * cannot see — which is simply untrue there.
   */
  const phone = buildSystemPrompt({ now: NOW, surface: "telegram" });

  assert.ok(!phone.includes("The map on screen"));
  assert.match(phone, /no screen\s+beside it and no map/);
  assert.match(phone, /send_to_phone/);

  const web = buildSystemPrompt({ now: NOW, surface: "web" });
  assert.match(web, /The map on screen/);
  assert.ok(!web.includes("Where you are being read"));
});

test("a selected map point means nothing on a phone", () => {
  // The focus comes from a panel that is not there, so mentioning it would be
  // describing furniture in another room.
  const focus = { latitude: 16.84, longitude: 96.17, zone: "Asia/Yangon" };

  assert.ok(
    !buildSystemPrompt({ now: NOW, surface: "telegram", focus }).includes(
      "Where they are pointing",
    ),
  );
  assert.match(
    buildSystemPrompt({ now: NOW, surface: "web", focus }),
    /Where they are pointing/,
  );
});

test("the web is the default, so a caller that says nothing gets the map", () => {
  assert.match(buildSystemPrompt({ now: NOW }), /The map on screen/);
});
