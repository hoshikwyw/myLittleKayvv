import { configured } from "@/lib/env";
import { cronAuthorised } from "@/lib/cron-auth";
import { configuredChannels } from "@/lib/notify";
import { runReminderSweep } from "@/lib/reminders/sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The reminder sweep endpoint.
 *
 * Called every fifteen minutes by an external scheduler (cron-job.org, see
 * SETUP-DEPLOY.md) with `Authorization: Bearer $CRON_SECRET`. A timed plan is
 * reminded near its time, which needs a sweep running through the day.
 *
 * Vercel Cron still calls it once a day as well. Hobby allows nothing more
 * frequent, which is why timed reminders need the external scheduler at all —
 * but at 00:00 UTC, 06:30 in Yangon, it keeps the morning digest of birthdays
 * going if that scheduler ever stops.
 *
 * Every run is safe to repeat: each reminder is marked once it is delivered,
 * so however many schedulers call this, nothing is sent twice.
 *
 * `?dryRun=1` reports what would be sent without sending or marking anything,
 * so the sweep can be exercised without waiting a day or spending a message.
 */
/**
 * The secret, from the Authorization header or `?secret=`.
 *
 * The header is the proper place. The query string is there because a
 * scheduler's header settings are a second form, easy to leave unsaved, and a
 * sweep that is silently refused means reminders that silently never come.
 * A URL is one field that either works or does not. Vercel's request logs are
 * private to the project, which is the only place the URL is recorded.
 */
async function handle(request: Request) {
  const header = request.headers.get("authorization");
  const query = new URL(request.url).searchParams.get("secret");
  const secret = process.env.CRON_SECRET;

  // Either will do: a stale header left in a scheduler must not stop a
  // correct secret in the URL from being accepted.
  if (!cronAuthorised(header, secret) && !cronAuthorised(query, secret)) {
    // Say which of the two it was. Neither answer tells a stranger anything
    // about the secret, and it is the difference between fixing a scheduler
    // in one try and guessing.
    return Response.json(
      {
        error: "Unauthorised",
        reason: header || query
          ? "A secret was sent, but it does not match CRON_SECRET."
          : "No secret was sent. Add the header Authorization: Bearer <CRON_SECRET>, or ?secret=<CRON_SECRET> to the URL.",
      },
      { status: 401 },
    );
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
