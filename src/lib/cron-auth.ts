/**
 * Whether a request to the reminder sweep carries the cron secret.
 *
 * The secret is typed by hand into two dashboards — Vercel's, and the external
 * scheduler's — and an exact comparison turned every slip into a silent 401:
 * "Bearer" left off, a quote pasted along with the value, a trailing space.
 * Reminders then simply never arrived. So both sides are normalised first, and
 * only the secret itself has to match, exactly.
 *
 * The comparison runs over every character regardless, so a wrong secret
 * cannot be narrowed down by timing the response.
 */

/** Strips whitespace and one layer of matching quotes. */
function clean(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return (quoted ? quoted[2] : trimmed).trim();
}

export function cronAuthorised(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!header || !secret) return false;

  const expected = clean(secret);
  // An empty secret would let an empty header through.
  if (!expected) return false;

  // "Bearer <secret>", or the secret alone.
  const given = clean(clean(header).replace(/^bearer\s+/i, ""));

  if (given.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
