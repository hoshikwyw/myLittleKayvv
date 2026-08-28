import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ---------------------------------------------------------------------------
 * Single-user by design (decision D1). No `user_id` columns — adding them
 * later is a migration, and carrying them now would be dead weight.
 * ------------------------------------------------------------------------ */

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

/* ===========================================================================
 * People
 * ======================================================================== */

export const dateKindEnum = pgEnum("date_kind", [
  "birthday",
  "anniversary",
  "memorial",
  "milestone",
  "custom",
]);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Full name as you would write it. */
    name: text("name").notNull(),
    /** What you actually call them out loud. The assistant uses this. */
    nickname: text("nickname"),
    /** Other things they get called, so "mum" and "Daw Aye" resolve to one row. */
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),

    /** Free text: "partner", "younger brother", "colleague at work". */
    relationship: text("relationship"),
    /** Stated pronouns. Never inferred from a name. */
    pronouns: text("pronouns"),

    /** 0 = ordinary, higher = the assistant should try harder to keep up. */
    importance: smallint("importance").notNull().default(0),

    /** Loose contact details; shape stays flexible on purpose. */
    contact: jsonb("contact").$type<{
      phone?: string;
      email?: string;
      telegram?: string;
      handles?: Record<string, string>;
    }>(),

    notes: text("notes"),

    createdAt,
    updatedAt,
  },
  (t) => [
    index("people_name_idx").on(t.name),
    index("people_importance_idx").on(t.importance),
    /**
     * The agent runs a batch of tool calls concurrently, so remember_person
     * and remember_date for the same person reach upsertPerson at the same
     * moment. A find-then-insert cannot be atomic in application code, and the
     * result was one row per concurrent call. The database has to enforce it.
     */
    uniqueIndex("people_name_unique").on(sql`lower(${t.name})`),
  ],
);

/* ===========================================================================
 * Important dates
 *
 * Stored as month/day parts rather than a timestamp. A birthday is not an
 * instant — it is a calendar recurrence, and timestamps drag in timezone and
 * leap-year bugs the moment a cron job running in UTC compares them. `year`
 * is nullable because you often know the day but not the year.
 * ======================================================================== */

export const important_dates = pgTable(
  "important_dates",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    personId: uuid("person_id").references(() => people.id, {
      onDelete: "cascade",
    }),

    /** "Birthday", "Our anniversary", "Visa renewal". */
    label: text("label").notNull(),
    kind: dateKindEnum("kind").notNull().default("custom"),

    month: smallint("month").notNull(), // 1-12
    day: smallint("day").notNull(), // 1-31
    year: smallint("year"), // null when unknown

    /** Annual recurrence off means it fires once, on that exact year. */
    recurring: boolean("recurring").notNull().default(true),

    /** Days of warning. {7,1,0} = a week before, the day before, and on the day. */
    remindDaysBefore: integer("remind_days_before")
      .array()
      .notNull()
      .default(sql`'{7,1,0}'::integer[]`),

    /**
     * Guards against duplicate sends. The cron sweep writes the date it last
     * notified for this row, so a re-run in the same window stays silent.
     */
    lastNotifiedOn: date("last_notified_on"),

    notes: text("notes"),

    createdAt,
    updatedAt,
  },
  (t) => [
    // The cron sweep's access pattern: "what falls on this month and day?"
    index("important_dates_month_day_idx").on(t.month, t.day),
    index("important_dates_person_idx").on(t.personId),
  ],
);

/* ===========================================================================
 * Plans — your schedule and tasks
 * ======================================================================== */

export const planStatusEnum = pgEnum("plan_status", [
  "pending",
  "done",
  "cancelled",
]);

export const planSourceEnum = pgEnum("plan_source", [
  "user",
  "assistant",
  "google_calendar",
]);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    title: text("title").notNull(),
    details: text("details"),
    location: text("location"),

    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),

    status: planStatusEnum("status").notNull().default("pending"),
    source: planSourceEnum("source").notNull().default("user"),

    /** Stable id from an external calendar, so re-syncing updates not duplicates. */
    externalId: text("external_id"),

    remindAt: timestamp("remind_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),

    createdAt,
    updatedAt,
  },
  (t) => [
    index("plans_starts_at_idx").on(t.startsAt),
    index("plans_status_idx").on(t.status),
    uniqueIndex("plans_external_id_idx").on(t.externalId),
  ],
);

/* ===========================================================================
 * Conversations
 * ======================================================================== */

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "tool",
]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("conversations_last_message_idx").on(t.lastMessageAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),

    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),

    /** Tool calls and their results, kept for replay and debugging. */
    toolCalls: jsonb("tool_calls").$type<
      Array<{ name: string; args: unknown; result?: unknown }>
    >(),

    createdAt,
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/* ===========================================================================
 * Memories — the semantic half of the two-tier memory system
 *
 * Structured facts live in `people`, `important_dates`, and `plans`, and are
 * queried exactly. This table is for everything that resists a schema:
 * preferences, moments, offhand remarks worth recalling later.
 * ======================================================================== */

export const memoryKindEnum = pgEnum("memory_kind", [
  "fact",
  "preference",
  "event",
  "relationship",
  "other",
]);

/**
 * 768 dimensions: Gemini's embedding model supports truncation to 768, and
 * pgvector's HNSW index caps out at 2000. Cheap to store, plenty for recall
 * over a personal corpus.
 */
export const EMBEDDING_DIMENSIONS = 768;

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Optional subject. A memory about nobody in particular is still valid. */
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "cascade",
    }),

    content: text("content").notNull(),
    kind: memoryKindEnum("kind").notNull().default("fact"),

    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),

    /**
     * Decision D6: facts are auto-extracted from conversation, then surfaced
     * as an undoable card. Unconfirmed memories are recalled with lower trust
     * and are the ones the UI offers you to correct or delete.
     */
    confirmed: boolean("confirmed").notNull().default(false),
    /** The model's own confidence at extraction time, 0-1. */
    confidence: real("confidence"),

    /** Where this came from, so you can always see the receipts. */
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),

    recallCount: integer("recall_count").notNull().default(0),
    lastRecalledAt: timestamp("last_recalled_at", { withTimezone: true }),

    createdAt,
    updatedAt,
  },
  (t) => [
    index("memories_person_idx").on(t.personId),
    index("memories_confirmed_idx").on(t.confirmed),
    // HNSW over cosine distance: the right default for text embeddings.
    index("memories_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

/* ===========================================================================
 * Notification log — audit trail for the proactive engine
 * ======================================================================== */

export const notificationChannelEnum = pgEnum("notification_channel", [
  "telegram",
  "email",
  "in_app",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "sent",
  "failed",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    channel: notificationChannelEnum("channel").notNull(),
    status: notificationStatusEnum("status").notNull(),

    /** What triggered it: an important_dates row, a plan, or nothing. */
    importantDateId: uuid("important_date_id").references(
      () => important_dates.id,
      { onDelete: "set null" },
    ),
    planId: uuid("plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),

    body: text("body").notNull(),
    error: text("error"),

    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_sent_at_idx").on(t.sentAt)],
);

/* ===========================================================================
 * Relations
 * ======================================================================== */

export const peopleRelations = relations(people, ({ many }) => ({
  importantDates: many(important_dates),
  memories: many(memories),
}));

export const importantDatesRelations = relations(important_dates, ({ one }) => ({
  person: one(people, {
    fields: [important_dates.personId],
    references: [people.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  person: one(people, {
    fields: [memories.personId],
    references: [people.id],
  }),
  sourceMessage: one(messages, {
    fields: [memories.sourceMessageId],
    references: [messages.id],
  }),
}));

/* ===========================================================================
 * Inferred types
 * ======================================================================== */

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type ImportantDate = typeof important_dates.$inferSelect;
export type NewImportantDate = typeof important_dates.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof messages.$inferSelect;
export type NewConversationMessage = typeof messages.$inferInsert;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
