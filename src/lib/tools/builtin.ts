import { z } from "zod";
import { env } from "@/lib/env";
import { evaluateExpression } from "./arithmetic";
import { defineTool } from "./types";

/**
 * Tools that need no external service and no database.
 *
 * They exist so the agent loop can be exercised end to end before Parts 4 and
 * 7 add memory and the Google integrations.
 */

export const currentDateTime = defineTool({
  name: "get_current_datetime",
  description:
    "Get the current date and time in the user's timezone. Call this before " +
    "any reasoning about today, tomorrow, days of the week, or how far away a " +
    "date is. Never guess the date.",
  schema: z.object({}),
  handler: (_args, { now }) => {
    const timezone = env.timezone;

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";

    // en-CA formats as YYYY-MM-DD. Deriving the numeric date from the same
    // timezone-aware formatter matters: reading the month off the server's
    // local clock would be a day out whenever the two disagree, which near
    // midnight is exactly when reminders care.
    const isoDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

    return {
      timezone,
      weekday: get("weekday"),
      date: isoDate,
      readable: `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`,
      time: `${get("hour")}:${get("minute")}`,
      iso: now.toISOString(),
    };
  },
});

export const calculate = defineTool({
  name: "calculate",
  description:
    "Evaluate an arithmetic expression and return the exact result. Use this " +
    "for any calculation rather than working it out yourself. Supports " +
    "+ - * / % ^ and parentheses. Percentages must be written out, so 15% of " +
    "4200 becomes 0.15 * 4200.",
  schema: z.object({
    expression: z
      .string()
      .min(1)
      .max(200)
      .describe("An arithmetic expression, for example (12 + 8) * 3.5"),
  }),
  handler: ({ expression }) => ({
    expression,
    result: evaluateExpression(expression),
  }),
});

export const builtinTools = [currentDateTime, calculate];
