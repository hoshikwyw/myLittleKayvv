/**
 * One password, one user, a signed cookie.
 *
 * This assistant holds birthdays, relationships and private notes about the
 * people someone loves, and deploying it puts that on a public URL. Without a
 * gate, anyone who found the address could read all of it, delete it, talk to
 * Kayv as though they were the owner, and spend the API quotas.
 *
 * Deliberately not an auth library. There is exactly one account, no sign-up,
 * no reset flow and no roles, so a provider would add a vendor, a bill and a
 * dependency to check a single string. This is a hundred lines of Web Crypto
 * and no framework tax (AGENTS.md, principle 4).
 *
 * Web Crypto rather than `node:crypto` because the proxy runs on the Edge
 * runtime, where `node:crypto` does not exist.
 */

export const SESSION_COOKIE = "kayv_session";

/** Long enough not to be a nuisance, short enough that a stolen laptop expires. */
const SESSION_DAYS = 30;

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** URL-safe base64, because this travels in a cookie. */
function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A token is "expiry.signature", where the signature covers the expiry.
 *
 * There is nothing else to carry — one user means no id to encode — and a
 * token that says only when it dies is a token with nothing worth stealing
 * beyond the session itself.
 */
export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = String(expiresAt);

  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(payload),
  );

  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const provided = token.slice(separator + 1);

  const expected = toBase64Url(
    await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)),
  );

  // Constant time. A byte-by-byte comparison that returns early leaks how much
  // of a forged signature was right, which is enough to build one a byte at a
  // time given enough attempts.
  if (!timingSafeEqual(provided, expected)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/**
 * Comparing the password itself, in constant time for the same reason.
 *
 * Both sides are hashed first so the comparison is always over equal-length
 * strings — otherwise the length of the real password leaks through how long
 * the check takes.
 */
export async function passwordMatches(
  attempt: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(attempt), sha256(expected)]);
  return timingSafeEqual(a, b);
}

async function sha256(value: string): Promise<string> {
  return toBase64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/** The cookie, spelled out once so the login and the proxy cannot disagree. */
export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    // A cookie readable by script is a cookie an XSS can take.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
