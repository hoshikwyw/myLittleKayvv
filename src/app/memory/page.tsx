import Link from "next/link";
import {
  CalendarHeart,
  ListChecks,
  Sparkles,
  User,
} from "lucide-react";
import { configured, env } from "@/lib/env";
import { loadMemoryOverview } from "@/lib/memory/overview";
import { describeYears } from "@/lib/memory/calendar";
import { ForgetButton } from "@/components/forget-button";
import { InlineEdit } from "@/components/inline-edit";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Everything the assistant remembers, on one page.
 *
 * The counterpart to the undo card: that catches a wrong fact in the moment,
 * this catches one weeks later. Nothing should be stored about the people in
 * someone's life without them being able to look at it, correct it, and take
 * it back.
 */

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-text-faint py-6 text-center text-sm">{children}</p>;
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof User;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-text-muted flex items-center gap-2 text-xs font-medium tracking-widest uppercase">
        <Icon className="text-accent size-3.5" aria-hidden="true" />
        {title}
        {count !== undefined && count > 0 && (
          <span className="text-text-faint font-mono normal-case">{count}</span>
        )}
        <span className="rule-fade ml-1 h-px flex-1" aria-hidden="true" />
      </h2>
      {children}
    </section>
  );
}

export default async function MemoryPage() {
  if (!configured.database()) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
        <h1 className="text-xl font-semibold">Memory</h1>
        <p className="text-text-muted text-sm leading-relaxed">
          Memory is offline — <span className="font-mono">DATABASE_URL</span> is
          not set, so there is nothing stored to show you.
        </p>
        <Link href="/" className="text-accent text-sm">
          Back to {env.assistantName}
        </Link>
      </main>
    );
  }

  const overview = await loadMemoryOverview();
  const { counts } = overview;
  const nothingStored =
    counts.people === 0 && counts.facts === 0 && counts.plans === 0;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-mono text-lg font-semibold tracking-[0.15em] uppercase">
            {env.assistantName} · memory
          </h1>
          <p className="text-text-muted text-sm">
            Everything stored. Correct anything that is wrong, forget anything
            that should not be here.
          </p>
        </div>
        <Link
          href="/"
          className="text-text-faint hover:text-text shrink-0 text-xs transition-colors"
        >
          back
        </Link>
      </header>

      {nothingStored ? (
        <Empty>
          Nothing yet. Tell {env.assistantName} about someone and it will appear
          here.
        </Empty>
      ) : (
        <>
          {overview.upcoming.length > 0 && (
            <Section icon={CalendarHeart} title="Coming up">
              <ul className="flex flex-col gap-2">
                {overview.upcoming.map((date) => (
                  <li
                    key={date.id}
                    className={cn(
                      "hud-frame border-border bg-surface/70 flex items-center gap-3 rounded-sm border px-4 py-3",
                      // Today and tomorrow are the ones that actually matter.
                      date.daysAway <= 1 &&
                        "hud-frame-live border-accent/40 bg-accent-soft shadow-[0_0_28px_-14px_var(--accent)]",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {date.personName
                          ? `${date.personName} — ${date.label}`
                          : date.label}
                      </span>
                      <span className="text-text-muted text-xs">
                        {date.when}
                        {date.turning !== null &&
                          ` · ${describeYears(date.kind, date.turning)}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section icon={User} title="People" count={counts.people}>
            {overview.people.length === 0 ? (
              <Empty>No one stored yet.</Empty>
            ) : (
              <ul className="flex flex-col gap-3">
                {overview.people.map((person) => (
                  <li
                    key={person.id}
                    className="hud-frame border-border bg-surface/70 shadow-soft hover:border-border-strong flex flex-col gap-3 rounded-sm border px-4 py-3.5 transition-colors duration-200"
                  >
                    <div className="flex items-start gap-2">
                      <InlineEdit
                        kind="person"
                        id={person.id}
                        label={person.name}
                        fields={[
                          {
                            name: "name",
                            label: "Name",
                            value: person.name,
                            required: true,
                          },
                          {
                            name: "nickname",
                            label: "Called",
                            value: person.nickname ?? "",
                          },
                          {
                            name: "relationship",
                            label: "Relationship",
                            value: person.relationship ?? "",
                          },
                          {
                            name: "pronouns",
                            label: "Pronouns",
                            value: person.pronouns ?? "",
                            placeholder: "only if stated",
                          },
                        ]}
                      >
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {person.name}
                            {person.nickname && (
                              <span className="text-text-muted font-normal">
                                {" "}
                                · {person.nickname}
                              </span>
                            )}
                          </span>
                          <span className="text-text-muted text-xs">
                            {[
                              person.relationship,
                              person.pronouns,
                              person.aliases.length > 0 &&
                                `also: ${person.aliases.join(", ")}`,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "no details yet"}
                          </span>
                        </span>
                      </InlineEdit>
                      <ForgetButton
                        kind="person"
                        id={person.id}
                        label={person.name}
                      />
                    </div>

                    {person.notes && (
                      <p className="text-text-muted border-border border-l-2 pl-3 text-xs leading-relaxed">
                        {person.notes}
                      </p>
                    )}

                    {person.dates.length > 0 && (
                      <ul className="flex flex-col gap-1.5">
                        {person.dates.map((date) => (
                          <li
                            key={date.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <CalendarHeart
                              className="text-accent size-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <InlineEdit
                              kind="date"
                              id={date.id}
                              label={`${person.name}'s ${date.label}`}
                              fields={[
                                {
                                  name: "label",
                                  label: "What",
                                  value: date.label,
                                  required: true,
                                },
                                {
                                  name: "day",
                                  label: "Day",
                                  value: String(date.dayOfMonth),
                                  numeric: true,
                                },
                                {
                                  name: "month",
                                  label: "Month",
                                  value: String(date.monthOfYear),
                                  numeric: true,
                                },
                                {
                                  name: "year",
                                  label: "Year",
                                  value: date.year === null ? "" : String(date.year),
                                  numeric: true,
                                  placeholder: "unknown",
                                },
                              ]}
                            >
                              <span className="block truncate">
                                <span className="font-medium">{date.label}</span>
                                <span className="text-text-muted">
                                  {" "}
                                  · {date.when} · {date.nextIn}
                                  {date.turning !== null &&
                                    ` · ${describeYears(date.kind, date.turning)}`}
                                </span>
                              </span>
                            </InlineEdit>
                            <ForgetButton
                              kind="date"
                              id={date.id}
                              label={`${person.name}'s ${date.label}`}
                            />
                          </li>
                        ))}
                      </ul>
                    )}

                    {person.facts.length > 0 && (
                      <ul className="flex flex-col gap-1.5">
                        {person.facts.map((fact) => (
                          <li
                            key={fact.id}
                            className="flex items-start gap-2 text-xs"
                          >
                            <Sparkles
                              className="text-text-faint mt-0.5 size-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <InlineEdit
                              kind="fact"
                              id={fact.id}
                              label="this note"
                              fields={[
                                {
                                  name: "content",
                                  label: "Note",
                                  value: fact.content,
                                  required: true,
                                },
                              ]}
                            >
                              <span className="text-text-muted block leading-relaxed">
                                {fact.content}
                                {!fact.confirmed && (
                                  // Inferred rather than stated, so it is the
                                  // likelier one to be wrong.
                                  <span className="text-text-faint">
                                    {" "}
                                    · inferred
                                  </span>
                                )}
                              </span>
                            </InlineEdit>
                            <ForgetButton
                              kind="fact"
                              id={fact.id}
                              label="this note"
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {overview.plans.length > 0 && (
            <Section icon={ListChecks} title="Plans" count={counts.plans}>
              <ul className="flex flex-col gap-2">
                {overview.plans.map((plan) => (
                  <li
                    key={plan.id}
                    className="hud-frame border-border bg-surface/70 flex items-center gap-3 rounded-sm border px-4 py-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{plan.title}</span>
                      <span className="text-text-muted text-xs">
                        {plan.when ?? "no date set"}
                        {plan.repeats && ` · ${plan.repeats}`}
                        {plan.where && ` · ${plan.where}`}
                      </span>
                    </span>
                    <ForgetButton kind="plan" id={plan.id} label={plan.title} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {overview.looseFacts.length > 0 && (
            <Section icon={Sparkles} title="Other notes">
              <ul className="flex flex-col gap-2">
                {overview.looseFacts.map((fact) => (
                  <li
                    key={fact.id}
                    className="hud-frame border-border bg-surface/70 flex items-start gap-3 rounded-sm border px-4 py-3"
                  >
                    <span className="min-w-0 flex-1 text-sm leading-relaxed">
                      {fact.content}
                    </span>
                    <ForgetButton kind="fact" id={fact.id} label="this note" />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </main>
  );
}
