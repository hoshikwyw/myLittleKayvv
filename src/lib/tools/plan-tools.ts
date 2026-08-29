import { z } from "zod";
import {
  addPlan,
  asRecurring,
  completePlanByTitle,
  listPlans,
} from "@/lib/memory/plans";
import { describeRecurrence } from "@/lib/memory/recurrence";
import { env } from "@/lib/env";
import { defineTool } from "./types";
import type { MemoryWriteLog } from "./memory-tools";

/**
 * Plans and tasks the assistant writes down itself.
 *
 * Distinct from `read_calendar`, which is read-only. Anything the user asks to
 * be remembered as a commitment lands here, and the undo card covers it exactly
 * as it covers a stored fact.
 */
export function createPlanTools(log: MemoryWriteLog) {
  const addPlanTool = defineTool({
    name: "add_plan",
    description:
      "Write down something the user intends to do — an appointment, an " +
      "errand, a task. Call get_current_datetime first if the user said " +
      '"tomorrow" or "Friday", so the date you store is actually right. Omit ' +
      "the time for something with no particular hour.",
    mutates: true,
    schema: z.object({
      title: z.string().min(2).max(160).describe("What they intend to do"),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("YYYY-MM-DD in the user's timezone. Omit if undated."),
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional()
        .describe("HH:mm, 24-hour, in the user's timezone. Omit for all day."),
      location: z.string().max(160).optional(),
      details: z.string().max(500).optional(),
      repeat: z
        .enum(["none", "daily", "weekly", "monthly", "yearly"])
        .default("none")
        .describe(
          "How often it comes back. Use this for anything the user says " +
            'happens regularly — "every morning", "on Sundays", "on the 1st".',
        ),
      repeat_days: z
        .array(z.number().int().min(0).max(6))
        .max(7)
        .optional()
        .describe(
          "For a weekly repeat, which days it lands on. 0 is Sunday. Omit " +
            "and it repeats on the same weekday as the start date.",
        ),
    }),
    handler: async (input, { now }) => {
      const plan = await addPlan(
        {
          ...input,
          recurrence: input.repeat,
          recurrenceDays: input.repeat_days,
        },
        // addPlan anchors a repeat to today when no date is given.
        now,
      );

      const repeats = asRecurring(plan)
        ? describeRecurrence(asRecurring(plan)!)
        : null;

      log.record({
        kind: "plan",
        id: plan.id,
        summary: [
          plan.title,
          plan.startsAt &&
            `${new Intl.DateTimeFormat("en-CA", { timeZone: env.timezone }).format(plan.startsAt)}${input.time ? ` ${input.time}` : ""}`,
          repeats,
        ]
          .filter(Boolean)
          .join(" — "),
      });

      return {
        id: plan.id,
        title: plan.title,
        scheduled: Boolean(plan.startsAt),
        repeats,
      };
    },
  });

  const whatsOn = defineTool({
    name: "whats_on",
    description:
      "List the plans and tasks the user has written down, from today " +
      "forward. Use this for anything about their own to-do list or what they " +
      "have on. For meetings from their Google Calendar, use read_calendar " +
      "instead — the two are separate.",
    schema: z.object({
      within_days: z
        .number()
        .int()
        .min(0)
        .max(90)
        .default(7)
        .describe("How far ahead to look. 0 means today only."),
    }),
    handler: async ({ within_days }, { now }) => {
      const found = await listPlans(within_days, now);

      return {
        count: found.length,
        withinDays: within_days,
        plans: found.map((plan) => ({
          what: plan.title,
          when: plan.when ?? "no date set",
          where: plan.where,
          daysAway: plan.daysAway,
          repeats: plan.repeats,
        })),
      };
    },
  });

  const completePlan = defineTool({
    name: "complete_plan",
    description:
      "Mark a plan as done, matched loosely by its title. Only call this when " +
      "the user says they have finished something.",
    mutates: true,
    schema: z.object({
      title: z
        .string()
        .min(2)
        .max(160)
        .describe("Enough of the title to identify it"),
    }),
    handler: async ({ title }) => {
      const done = await completePlanByTitle(title);
      if (!done) {
        return { found: false, note: `Nothing pending matching "${title}".` };
      }
      return { found: true, title: done.title, status: done.status };
    },
  });

  return [addPlanTool, whatsOn, completePlan];
}
