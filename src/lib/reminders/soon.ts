import { after } from "next/server";
import { runReminderSweep } from "./sweep";

/**
 * Checks reminders straight after a timed plan is written down.
 *
 * The scheduled sweep runs every fifteen minutes, on the quarter hour, and a
 * plan is reminded from fifteen minutes before it starts. So a plan added at
 * 13:33 for 13:35 had already missed the 13:30 run, and waited for the 13:45
 * one — ten minutes after the thing it was meant to announce. Any plan made
 * less than a quarter of an hour ahead could fall in that gap.
 *
 * Running the sweep once more, the moment the plan exists, closes it. It runs
 * after the response is sent, so the reply is not held up by Telegram and
 * Firebase. The sweep is safe to repeat — each reminder is marked when it is
 * delivered — so this can never send something twice that the schedule then
 * sends again.
 */
export function sweepAfterPlanAdded(timed: boolean): void {
  if (!timed) return;

  try {
    after(async () => {
      try {
        await runReminderSweep(new Date());
      } catch (error) {
        // The scheduled sweep is still coming; this was only a head start.
        console.warn("Reminder check after adding a plan failed:", error);
      }
    });
  } catch {
    // Outside a request — a script or a test — there is nothing to run after,
    // and nothing is lost: the scheduled sweep picks the plan up as usual.
  }
}
