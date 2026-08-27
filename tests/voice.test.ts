import { test } from "node:test";
import assert from "node:assert/strict";
import {
  containsBurmese,
  extractSentences,
  toSpeakable,
} from "@/lib/voice/sentences";
import { escapeHtml } from "@/lib/notify/telegram";
import { evaluateExpression } from "@/lib/tools/arithmetic";

test("sentences are split only when complete", () => {
  assert.deepEqual(extractSentences("Hello there. "), {
    sentences: ["Hello there."],
    rest: "",
  });
  assert.deepEqual(extractSentences("Hello there. How are"), {
    sentences: ["Hello there."],
    rest: "How are",
  });
  assert.deepEqual(extractSentences("One. Two! Three? rest"), {
    sentences: ["One.", "Two!", "Three?"],
    rest: "rest",
  });
});

test("a trailing terminator is not a boundary — it may be a decimal", () => {
  // "3" could still become "3.5", so nothing is spoken yet.
  assert.deepEqual(extractSentences("The total is 3"), {
    sentences: [],
    rest: "The total is 3",
  });
  assert.deepEqual(extractSentences("The total is 3.5 dollars"), {
    sentences: [],
    rest: "The total is 3.5 dollars",
  });
  assert.deepEqual(extractSentences("It is 3.5. Next"), {
    sentences: ["It is 3.5."],
    rest: "Next",
  });
});

test("a run of terminators breaks once, and newlines break", () => {
  assert.deepEqual(extractSentences("Really?! Yes"), {
    sentences: ["Really?!"],
    rest: "Yes",
  });
  assert.deepEqual(extractSentences("First line\nsecond"), {
    sentences: ["First line"],
    rest: "second",
  });
});

test("a streamed reply reassembles across awkward chunk boundaries", () => {
  let buffer = "";
  const spoken: string[] = [];

  for (const chunk of [
    "Your sister ",
    "Nandar turns 2",
    "8 on 3 March. I",
    "'ll remind you",
    " a week before. ",
  ]) {
    buffer += chunk;
    const { sentences, rest } = extractSentences(buffer);
    buffer = rest;
    spoken.push(...sentences);
  }

  assert.deepEqual(spoken, [
    "Your sister Nandar turns 28 on 3 March.",
    "I'll remind you a week before.",
  ]);
});

test("Burmese is detected so it is never handed to an English voice", () => {
  assert.equal(containsBurmese("မင်္ဂလာပါ"), true);
  assert.equal(containsBurmese("Hello there"), false);
  assert.equal(containsBurmese("Hello မင်္ဂလာ"), true);
  assert.equal(extractSentences("မင်္ဂလာပါ။ next").sentences[0], "မင်္ဂလာပါ။");
});

test("markdown is stripped before speaking", () => {
  assert.equal(toSpeakable("This is **important** now"), "This is important now");
  assert.equal(toSpeakable("## Title"), "Title");
  assert.equal(toSpeakable("see [the docs](https://x.com)"), "see the docs");
});

test("Telegram HTML escaping covers exactly what it must", () => {
  // A hyphenated surname would have broken MarkdownV2 entirely.
  assert.equal(escapeHtml("Aye-Chan's Birthday is today."), "Aye-Chan's Birthday is today.");
  assert.equal(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
  assert.equal(escapeHtml("a <b> c"), "a &lt;b&gt; c");
  assert.equal(escapeHtml("_*[]()~`#+=|{}.!"), "_*[]()~`#+=|{}.!");
  assert.equal(escapeHtml("မင်္ဂလာပါ"), "မင်္ဂလာပါ");
  // Ampersand must be replaced first or entities get double-escaped.
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("the calculator computes correctly", () => {
  assert.equal(evaluateExpression("2+3*4"), 14);
  assert.equal(evaluateExpression("(2+3)*4"), 20);
  assert.equal(evaluateExpression("-5+2"), -3);
  assert.equal(evaluateExpression("2^3^2"), 512); // right associative
  assert.equal(evaluateExpression("1,200*2"), 2400); // thousands separator
  assert.equal(evaluateExpression("0.15*4200+187"), 817);
});

test("the calculator parses rather than evaluates", () => {
  // Its input originates from text the model read, so this must not be code.
  for (const hostile of ["alert(1)", "process.exit()", "$(whoami)", "1..2", "2+", "(1+2", "1/0"]) {
    assert.throws(() => evaluateExpression(hostile), `should have rejected: ${hostile}`);
  }
});
