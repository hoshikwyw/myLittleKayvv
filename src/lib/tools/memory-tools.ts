import { z } from "zod";
import { upcomingDates, addImportantDate, validateMonthDay } from "@/lib/memory/dates";
import { recallMemories, storeMemory } from "@/lib/memory/facts";
import { findPerson, listPeople, personProfile, upsertPerson } from "@/lib/memory/people";
import { formatMonthDay } from "@/lib/memory/calendar";
import { defineTool } from "./types";

/**
 * Memory tools.
 *
 * Every write records what it changed on the shared write log below, so the
 * chat surface can offer an undo. Decision D6: facts are saved as they are
 * heard, then shown as a card you can take back — not held behind a prompt.
 */

export type MemoryWriteKind = "person" | "date" | "fact";

export interface MemoryWrite {
  kind: MemoryWriteKind;
  id: string;
  summary: string;
}

/**
 * Collects writes made during a single turn.
 *
 * Passed explicitly rather than kept in module scope: a module-level array
 * would be shared across concurrent requests in the same warm function
 * instance, and one person's undo card would show another's writes.
 */
export class MemoryWriteLog {
  private readonly writes: MemoryWrite[] = [];

  record(write: MemoryWrite) {
    this.writes.push(write);
  }

  drain(): MemoryWrite[] {
    return this.writes.splice(0, this.writes.length);
  }
}

export function createMemoryTools(log: MemoryWriteLog) {
  const rememberPerson = defineTool({
    name: "remember_person",
    description:
      "Save or update someone in the user's life. Call this the first time a " +
      "person is mentioned by name, and again whenever a new detail about " +
      "them comes up. Pass only the fields you actually learned — omitted " +
      "fields keep whatever was already stored.",
    mutates: true,
    schema: z.object({
      name: z.string().min(1).max(120).describe("Their full name as best you know it"),
      nickname: z.string().max(60).optional().describe("What the user calls them"),
      aliases: z
        .array(z.string().max(60))
        .max(8)
        .optional()
        .describe('Other ways they get referred to, such as "my sister"'),
      relationship: z
        .string()
        .max(80)
        .optional()
        .describe('How they relate to the user, such as "partner" or "colleague"'),
      pronouns: z
        .string()
        .max(30)
        .optional()
        .describe("Only if the user stated them. Never guess from a name."),
      notes: z.string().max(500).optional().describe("Anything else worth keeping"),
      importance: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe("0 for an acquaintance, higher for someone central to their life"),
    }),
    handler: async (input) => {
      const { person, created } = await upsertPerson(input);

      if (created) {
        log.record({
          kind: "person",
          id: person.id,
          summary: `Added ${person.name}${person.relationship ? ` (${person.relationship})` : ""}`,
        });
      }

      return {
        id: person.id,
        name: person.name,
        created,
        stored: created ? "new person" : "updated existing person",
      };
    },
  });

  const rememberDate = defineTool({
    name: "remember_date",
    description:
      "Save a birthday, anniversary, or any other date that recurs and should " +
      "be reminded about. If the date belongs to a person, pass their name and " +
      "they will be created if unknown. Year is optional — omit it when you " +
      "only know the day and month.",
    mutates: true,
    schema: z.object({
      person: z
        .string()
        .max(120)
        .optional()
        .describe("Whose date this is. Omit for a date about no one in particular."),
      label: z
        .string()
        .min(1)
        .max(120)
        .describe('What the date is, such as "Birthday" or "Our anniversary"'),
      kind: z
        .enum(["birthday", "anniversary", "memorial", "milestone", "custom"])
        .default("custom"),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
      year: z
        .number()
        .int()
        .min(1900)
        .max(2200)
        .optional()
        .describe("The original year, if known — the year they were born or married"),
      remind_days_before: z
        .array(z.number().int().min(0).max(365))
        .max(5)
        .optional()
        .describe("How many days of warning to give. Defaults to 7, 1, and 0."),
    }),
    handler: async (input) => {
      const invalid = validateMonthDay(input.month, input.day);
      if (invalid) throw new Error(invalid);

      let personId: string | undefined;
      let personName: string | undefined;

      if (input.person) {
        const { person, created } = await upsertPerson({ name: input.person });
        personId = person.id;
        personName = person.name;

        if (created) {
          log.record({
            kind: "person",
            id: person.id,
            summary: `Added ${person.name}`,
          });
        }
      }

      const date = await addImportantDate({
        personId,
        label: input.label,
        kind: input.kind,
        month: input.month,
        day: input.day,
        year: input.year,
        remindDaysBefore: input.remind_days_before,
      });

      const when = formatMonthDay(date.month, date.day);
      log.record({
        kind: "date",
        id: date.id,
        summary: personName
          ? `${personName}: ${date.label} on ${when}`
          : `${date.label} on ${when}`,
      });

      return {
        id: date.id,
        label: date.label,
        person: personName ?? null,
        when,
        remindDaysBefore: date.remindDaysBefore,
      };
    },
  });

  const rememberFact = defineTool({
    name: "remember_fact",
    description:
      "Save something worth recalling later that is not a date — a " +
      "preference, a detail, something that happened. Use this for anything " +
      "the user would be glad you remembered. Do not use it for dates; use " +
      "remember_date so the reminder actually fires.",
    mutates: true,
    schema: z.object({
      content: z
        .string()
        .min(3)
        .max(500)
        .describe("The fact, written as a full sentence so it reads back clearly"),
      about: z
        .string()
        .max(120)
        .optional()
        .describe("Whose fact this is, if it concerns a specific person"),
      kind: z
        .enum(["fact", "preference", "event", "relationship", "other"])
        .default("fact"),
      explicit: z
        .boolean()
        .default(false)
        .describe(
          "True only when the user asked you outright to remember it, false " +
            "when you inferred it from what they said",
        ),
    }),
    handler: async (input) => {
      let personId: string | undefined;

      if (input.about) {
        const person = await findPerson(input.about);
        personId = person?.id;
      }

      const memory = await storeMemory({
        content: input.content,
        personId,
        kind: input.kind,
        confirmed: input.explicit,
      });

      log.record({
        kind: "fact",
        id: memory.id,
        summary: memory.content,
      });

      return { id: memory.id, stored: true };
    },
  });

  const recall = defineTool({
    name: "recall",
    description:
      "Search everything you have been told, by meaning rather than exact " +
      "wording. Use this whenever the user refers to something from the past, " +
      "asks what you know about someone, or you are unsure whether you have " +
      "heard something before. Prefer calling it over guessing.",
    schema: z.object({
      query: z
        .string()
        .min(2)
        .max(300)
        .describe("What you are trying to remember, in natural language"),
      about: z.string().max(120).optional().describe("Narrow to one person"),
      limit: z.number().int().min(1).max(15).default(6),
    }),
    handler: async (input) => {
      let personId: string | undefined;
      if (input.about) {
        const person = await findPerson(input.about);
        if (!person) {
          return { found: 0, memories: [], note: `No one known as "${input.about}".` };
        }
        personId = person.id;
      }

      const found = await recallMemories({
        query: input.query,
        personId,
        limit: input.limit,
      });

      return {
        found: found.length,
        memories: found.map((m) => ({
          content: m.content,
          about: m.personName,
          // Told to us outright, or inferred. The model should hedge on inferred.
          certain: m.confirmed,
        })),
      };
    },
  });

  const whoIs = defineTool({
    name: "who_is",
    description:
      "Look up everything stored about one person: their details and all " +
      "their important dates. Use this when the user asks about someone, or " +
      "before answering a question that depends on who they are.",
    schema: z.object({
      name: z.string().min(1).max(120),
    }),
    handler: async ({ name }) => {
      const person = await findPerson(name);
      if (!person) return { found: false, note: `No one known as "${name}".` };
      return { found: true, ...(await personProfile(person)) };
    },
  });

  const whoDoIKnow = defineTool({
    name: "who_do_i_know",
    description:
      "List everyone stored, most important first. Use it when the user asks " +
      "who you know about, or when you need to check whether someone is " +
      "already known before adding them.",
    schema: z.object({}),
    handler: async () => {
      const everyone = await listPeople();
      return {
        count: everyone.length,
        people: everyone.map((p) => ({
          name: p.name,
          nickname: p.nickname,
          relationship: p.relationship,
        })),
      };
    },
  });

  const whatIsComingUp = defineTool({
    name: "what_is_coming_up",
    description:
      "List birthdays, anniversaries, and other stored dates falling within " +
      "the next N days. Use this for any question about what is coming up, " +
      "whose birthday is soon, or what the user should not forget.",
    schema: z.object({
      within_days: z
        .number()
        .int()
        .min(0)
        .max(365)
        .default(30)
        .describe("How far ahead to look. 30 unless the user implies otherwise."),
    }),
    handler: async ({ within_days }, { now }) => {
      const dates = await upcomingDates(within_days, now);
      return {
        count: dates.length,
        withinDays: within_days,
        dates: dates.map((d) => ({
          what: d.label,
          who: d.personName,
          when: d.when,
          daysAway: d.daysAway,
          turning: d.turning,
        })),
      };
    },
  });

  return [
    rememberPerson,
    rememberDate,
    rememberFact,
    recall,
    whoIs,
    whoDoIKnow,
    whatIsComingUp,
  ];
}
