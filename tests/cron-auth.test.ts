import { test } from "node:test";
import assert from "node:assert/strict";
import { cronAuthorised } from "@/lib/cron-auth";

const SECRET = "c0htAyXc_JmMMG0RvDAkf1aD9gJbApvy2FPfzjb4_Yw";

test("the standard Bearer header is accepted", () => {
  assert.equal(cronAuthorised(`Bearer ${SECRET}`, SECRET), true);
});

test("the slips people make in a scheduler's dashboard are forgiven", () => {
  // "Bearer" left off, in another case, or quoted along with the value.
  assert.equal(cronAuthorised(SECRET, SECRET), true);
  assert.equal(cronAuthorised(`bearer ${SECRET}`, SECRET), true);
  assert.equal(cronAuthorised(`Bearer "${SECRET}"`, SECRET), true);
  assert.equal(cronAuthorised(`"Bearer ${SECRET}"`, SECRET), true);
  assert.equal(cronAuthorised(`  Bearer   ${SECRET}  `, SECRET), true);
});

test("and so are the ones made in Vercel's", () => {
  assert.equal(cronAuthorised(`Bearer ${SECRET}`, ` ${SECRET}\n`), true);
  assert.equal(cronAuthorised(`Bearer ${SECRET}`, `"${SECRET}"`), true);
});

test("the secret itself still has to match exactly", () => {
  assert.equal(cronAuthorised("Bearer dev-only-change-me", SECRET), false);
  assert.equal(cronAuthorised(`Bearer ${SECRET.slice(0, -1)}`, SECRET), false);
  assert.equal(cronAuthorised(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(cronAuthorised(`Bearer ${SECRET.toLowerCase()}`, SECRET), false);
});

test("nothing is let through when either side is missing", () => {
  assert.equal(cronAuthorised(null, SECRET), false);
  assert.equal(cronAuthorised("", SECRET), false);
  assert.equal(cronAuthorised("Bearer ", SECRET), false);
  assert.equal(cronAuthorised(`Bearer ${SECRET}`, undefined), false);
  assert.equal(cronAuthorised("Bearer ", ""), false);
  assert.equal(cronAuthorised('Bearer ""', '""'), false);
});
