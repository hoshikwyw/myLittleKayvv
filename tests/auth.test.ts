import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  passwordMatches,
  sessionCookie,
  verifySession,
} from "@/lib/auth";

/**
 * The gate.
 *
 * Everything this protects is personal: birthdays, relationships, private
 * notes about the people the owner loves. A hole here is not a degraded
 * feature, it is that material on a public URL.
 */

const SECRET = "a-real-password-would-be-longer";

test("a session made with the password is accepted", async () => {
  const token = await createSession(SECRET);
  assert.equal(await verifySession(token, SECRET), true);
});

test("a session made with a different password is not", async () => {
  const token = await createSession("some other password");
  assert.equal(await verifySession(token, SECRET), false);
});

test("a tampered expiry is rejected", async () => {
  /**
   * The attack the signature exists to stop: take a real token, change the
   * expiry to the far future, and keep it forever. The signature covers the
   * expiry, so editing one invalidates the other.
   */
  const token = await createSession(SECRET);
  const [, signature] = token.split(".");

  const forged = `${Date.now() + 10 ** 12}.${signature}`;
  assert.equal(await verifySession(forged, SECRET), false);
});

test("an expired session is rejected even though it is properly signed", async () => {
  const past = Date.now() - 400 * 24 * 60 * 60 * 1000;
  const token = await createSession(SECRET, past);

  // Signed correctly — it was real once — and still no longer valid.
  assert.equal(await verifySession(token, SECRET), false);
});

test("a session lasts long enough to be useful", async () => {
  const token = await createSession(SECRET);
  const inAMonth = Date.now() + 29 * 24 * 60 * 60 * 1000;

  assert.equal(await verifySession(token, SECRET, inAMonth), true);
});

test("nonsense in the cookie is rejected rather than throwing", async () => {
  // Whatever arrives in a cookie is attacker-controlled, including nothing.
  for (const token of [
    undefined,
    "",
    ".",
    "no-separator",
    ".onlyasignature",
    "1234567890.",
    "not-a-number.c2lnbmF0dXJl",
    "a".repeat(5000),
  ]) {
    assert.equal(await verifySession(token, SECRET), false, String(token));
  }
});

test("the password comparison accepts only the password", async () => {
  assert.equal(await passwordMatches(SECRET, SECRET), true);
  assert.equal(await passwordMatches("wrong", SECRET), false);

  // A prefix must not pass. Hashing both sides first is what makes the
  // comparison equal-length whatever was submitted.
  assert.equal(await passwordMatches(SECRET.slice(0, -1), SECRET), false);
  assert.equal(await passwordMatches(SECRET + "x", SECRET), false);
  assert.equal(await passwordMatches("", SECRET), false);
});

test("the cookie cannot be read by script and does not travel across sites", () => {
  const cookie = sessionCookie("token");

  // A cookie readable by script is a cookie an XSS can take.
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.path, "/");
  assert.ok(cookie.maxAge > 0);
});

test("two sessions from the same password differ", async () => {
  // They carry their own expiry, so an old token cannot be replayed as a new
  // one simply by being identical.
  const first = await createSession(SECRET, 1_000_000);
  const second = await createSession(SECRET, 2_000_000);

  assert.notEqual(first, second);
});
