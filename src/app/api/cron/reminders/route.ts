import { configured, env } from "@/lib/env";
import { configuredChannels } from "@/lib/notify";
import { runReminderSweep } from "@/lib/reminders/sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The daily reminder sweep endpoint.
 *
 * Vercel Cron calls this once a day with `Authorization: Bearer $CRON_SECRET`.
 * Hobby allows a once-daily schedule in UTC only, and guarantees the hour
 * rather than the minute — which the sweep's idempotency guard is built for.
 *
 * 00:00 UTC lands at 06:30 in Yangon, which is a reasonable hour to be told
 * that someone's birthday is tomorrow.
 *
 * `?dryRun=1` reports what would be sent without sending or marking anything,
 * so the sweep can be exercised without waiting a day or spending a message.
 */
function isAuthorised(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const secret = env.cronSecret;
  const expected = `Bearer ${secret}`;

  // Constant-time-ish: compare lengths first, then every character, so a
  // wrong secret cannot be narrowed down by timing the response.
  if (header.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

async function handle(request: Request) {
  if (!isAuthorised(request)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  if (!configured.database()) {
    return Response.json(
      { error: "DATABASE_URL is not set — nothing to sweep" },
      { status: 503 },
    );
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  try {
    const result = await runReminderSweep(new Date(), { dryRun });

    return Response.json({
      ok: true,
      dryRun,
      availableChannels: configuredChannels(),
      ...result,
    });
  } catch (error) {
    // Returning 500 lets Vercel's log show a failed run rather than a quiet
    // success, which is the difference between noticing and not.
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

/** POST as well, so the sweep can be triggered by hand for a test. */
export async function POST(request: Request) {
  return handle(request);
}
