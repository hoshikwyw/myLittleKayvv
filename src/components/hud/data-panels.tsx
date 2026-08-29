"use client";

import { CalendarHeart, Sparkles } from "lucide-react";
import type { MemoryOverview } from "@/lib/memory/overview";
import { describeYears } from "@/lib/memory/calendar";
import { ForgetButton } from "@/components/forget-button";
import { InlineEdit } from "@/components/inline-edit";
import { cn } from "@/lib/utils";

/**
 * The read-out panels.
 *
 * Denser than the old pages on purpose: a panel is glanced at beside four
 * others, so anything that was a paragraph becomes a line.
 */

function Empty({ children }: { children: string }) {
  return <p className="hud-label py-6 text-center">{children}</p>;
}

/** Dates coming up, nearest first. */
export function UpcomingBody({ overview }: { overview: MemoryOverview }) {
  if (overview.upcoming.length === 0) return <Empty>no dates ahead</Empty>;

  return (
    <ul className="flex flex-col">
      {overview.upcoming.map((date) => (
        <li
          key={date.id}
          className={cn(
            "border-border/60 flex items-center gap-2.5 border-b px-3 py-2 last:border-b-0",
            date.daysAway <= 1 && "bg-accent-soft/40",
          )}
        >
          <CalendarHeart
            className={cn(
              "size-3.5 shrink-0",
              date.daysAway <= 1 ? "text-accent" : "text-text-faint",
            )}
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px]">
              {date.personName ? `${date.personName} · ${date.label}` : date.label}
            </span>
            {date.turning !== null && (
              <span className="text-text-faint font-mono text-[10px]">
                {describeYears(date.kind, date.turning)}
              </span>
            )}
          </span>
          <span
            className={cn(
              "shrink-0 font-mono text-[10px] tracking-wider",
              date.daysAway <= 1 ? "text-accent" : "text-text-muted",
            )}
          >
            {date.when.replace(/^.*\((.*)\)$/, "$1")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Plans and repeating tasks. */
export function PlansBody({ overview }: { overview: MemoryOverview }) {
  if (overview.plans.length === 0) return <Empty>no active plans</Empty>;

  return (
    <ul className="flex flex-col">
      {overview.plans.map((plan) => (
        <li
          key={plan.id}
          className="border-border/60 flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px]">{plan.title}</span>
            <span className="text-text-faint font-mono text-[10px]">
              {plan.when ?? "undated"}
              {plan.repeats && ` · ${plan.repeats}`}
            </span>
          </span>
          <ForgetButton kind="plan" id={plan.id} label={plan.title} />
        </li>
      ))}
    </ul>
  );
}

/** Everyone stored, with their dates and notes, editable in place. */
export function PeopleBody({ overview }: { overview: MemoryOverview }) {
  if (overview.people.length === 0) return <Empty>no records</Empty>;

  return (
    <ul className="flex flex-col">
      {overview.people.map((person) => (
        <li
          key={person.id}
          className="border-border/60 flex flex-col gap-2 border-b px-3 py-2.5 last:border-b-0"
        >
          <div className="flex items-start gap-1.5">
            <InlineEdit
              kind="person"
              id={person.id}
              label={person.name}
              fields={[
                { name: "name", label: "Name", value: person.name, required: true },
                { name: "nickname", label: "Called", value: person.nickname ?? "" },
                {
                  name: "relationship",
                  label: "Relation",
                  value: person.relationship ?? "",
                },
                {
                  name: "pronouns",
                  label: "Pronouns",
                  value: person.pronouns ?? "",
                  placeholder: "if stated",
                },
              ]}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">
                  {person.name}
                  {person.nickname && (
                    <span className="text-text-muted font-normal">
                      {" "}
                      · {person.nickname}
                    </span>
                  )}
                </span>
                <span className="text-text-faint font-mono text-[10px]">
                  {[person.relationship, person.pronouns]
                    .filter(Boolean)
                    .join(" · ") || "no details"}
                </span>
              </span>
            </InlineEdit>
            <ForgetButton kind="person" id={person.id} label={person.name} />
          </div>

          {person.dates.map((date) => (
            <div key={date.id} className="flex items-center gap-2 pl-1 text-xs">
              <CalendarHeart
                className="text-accent size-3 shrink-0"
                aria-hidden="true"
              />
              <InlineEdit
                kind="date"
                id={date.id}
                label={`${person.name}'s ${date.label}`}
                fields={[
                  { name: "label", label: "What", value: date.label, required: true },
                  {
                    name: "day",
                    label: "Day",
                    value: String(date.dayOfMonth),
                    numeric: true,
                  },
                  {
                    name: "month",
                    label: "Mon",
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
                <span className="text-text-muted block truncate">
                  {date.label} · {date.when} · {date.nextIn}
                </span>
              </InlineEdit>
              <ForgetButton
                kind="date"
                id={date.id}
                label={`${person.name}'s ${date.label}`}
              />
            </div>
          ))}

          {person.facts.map((fact) => (
            <div key={fact.id} className="flex items-start gap-2 pl-1 text-xs">
              <Sparkles
                className="text-text-faint mt-0.5 size-3 shrink-0"
                aria-hidden="true"
              />
              <InlineEdit
                kind="fact"
                id={fact.id}
                label="this note"
                fields={[
                  { name: "content", label: "Note", value: fact.content, required: true },
                ]}
              >
                <span className="text-text-muted block leading-relaxed">
                  {fact.content}
                  {!fact.confirmed && (
                    <span className="text-text-faint"> · inferred</span>
                  )}
                </span>
              </InlineEdit>
              <ForgetButton kind="fact" id={fact.id} label="this note" />
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

export interface SubsystemStatus {
  llm: boolean;
  database: boolean;
  maps: boolean;
  search: boolean;
  calendar: boolean;
  telegram: boolean;
  voice: boolean;
}

/** Which subsystems are live. The reference's SYSTEM STATUS panel. */
export function SystemBody({
  status,
  counts,
  model,
  timezone,
}: {
  status: SubsystemStatus;
  counts: MemoryOverview["counts"];
  model: string;
  timezone: string;
}) {
  const rows: Array<[string, boolean]> = [
    ["language model", status.llm],
    ["memory", status.database],
    ["voice", status.voice],
    ["telegram", status.telegram],
    ["maps", status.maps],
    ["web search", status.search],
    ["calendar", status.calendar],
  ];

  return (
    <div className="flex flex-col gap-3 px-3 py-2.5">
      <ul className="flex flex-col gap-1.5">
        {rows.map(([label, on]) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                on ? "bg-success" : "bg-text-faint/40",
              )}
              aria-hidden="true"
            />
            <span className="hud-label flex-1 !tracking-[0.16em]">{label}</span>
            <span
              className={cn(
                "font-mono text-[10px]",
                on ? "text-success" : "text-text-faint",
              )}
            >
              {on ? "ONLINE" : "OFFLINE"}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-border/60 grid grid-cols-4 gap-1 border-t pt-2.5">
        {(
          [
            ["people", counts.people],
            ["dates", counts.dates],
            ["notes", counts.facts],
            ["plans", counts.plans],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col items-center gap-0.5">
            <span className="text-accent font-mono text-base leading-none tabular-nums">
              {String(value).padStart(2, "0")}
            </span>
            <span className="hud-label !text-[9px]">{label}</span>
          </div>
        ))}
      </div>

      <div className="border-border/60 flex flex-col gap-1 border-t pt-2.5">
        <div className="flex justify-between">
          <span className="hud-label">model</span>
          <span className="text-text-muted font-mono text-[10px]">{model}</span>
        </div>
        <div className="flex justify-between">
          <span className="hud-label">timezone</span>
          <span className="text-text-muted font-mono text-[10px]">
            {timezone}
          </span>
        </div>
      </div>
    </div>
  );
}
