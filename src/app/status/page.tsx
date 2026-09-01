import Link from "next/link";
import { configured, env } from "@/lib/env";

/**
 * Build-status board.
 *
 * Not the product — a developer view showing which subsystems are wired up.
 * The assistant itself lives at /.
 */

// Read env at request time, not build time — otherwise the board would show
// whatever was configured when the bundle was built.
export const dynamic = "force-dynamic";

type Status = "ready" | "pending" | "planned";

interface Subsystem {
  part: number;
  name: string;
  detail: string;
  status: Status;
}

function buildStatus(): Subsystem[] {
  return [
    {
      part: 0,
      name: "Scaffold",
      detail: "Next.js, TypeScript, Tailwind, design tokens",
      status: "ready",
    },
    {
      part: 1,
      name: "Database",
      detail: configured.database()
        ? "Neon Postgres connected"
        : "Neon Postgres — set DATABASE_URL",
      status: configured.database() ? "ready" : "pending",
    },
    {
      part: 2,
      name: "Language model",
      detail: configured.llm()
        ? `Gemini (${env.geminiModel})`
        : "Gemini — set GEMINI_API_KEY",
      status: configured.llm() ? "ready" : "pending",
    },
    {
      part: 3,
      name: "Agent loop",
      detail: "Tool registry and reasoning loop",
      status: "ready",
    },
    {
      part: 4,
      name: "Memory",
      detail: configured.database()
        ? "People, dates, and semantic recall"
        : "People, dates, and recall — needs DATABASE_URL",
      status: configured.database() ? "ready" : "pending",
    },
    {
      part: 5,
      name: "Assistant shell",
      detail: "Conversation, voice orb, state machine",
      status: "ready",
    },
    { part: 6, name: "Voice", detail: "Speech in, speech out", status: "planned" },
    {
      part: 7,
      name: "External tools",
      detail: (() => {
        const on = [
          configured.maps() && "Place search",
          configured.search() && "Search",
          configured.calendar() && "Calendar",
        ].filter(Boolean);
        return on.length === 3
          ? "Place search, Search, Calendar"
          : on.length > 0
            ? `${on.join(" and ")} connected — add the rest`
            : "Maps, Search, Calendar — add API keys";
      })(),
      status:
        configured.maps() && configured.search() && configured.calendar()
          ? "ready"
          : "pending",
    },
    {
      part: 8,
      name: "Reminders",
      detail: configured.telegram()
        ? "Daily sweep at 00:00 UTC via Telegram"
        : configured.email()
          ? "Daily sweep at 00:00 UTC via email"
          : "Daily cron — add TELEGRAM_BOT_TOKEN or RESEND_API_KEY",
      status:
        configured.telegram() || configured.email() ? "ready" : "pending",
    },
  ];
}

const STATUS_STYLES: Record<Status, string> = {
  ready: "bg-accent-soft text-accent border-accent/30",
  pending: "bg-surface-2 text-warning border-warning/30",
  planned: "bg-surface-2 text-text-faint border-border",
};

const STATUS_LABEL: Record<Status, string> = {
  ready: "ready",
  pending: "needs config",
  planned: "planned",
};

export default function Home() {
  const subsystems = buildStatus();
  const readyCount = subsystems.filter((s) => s.status === "ready").length;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span
            className="bg-accent size-2.5 rounded-full"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-semibold tracking-tight">
            {env.assistantName}
          </h1>
        </div>
        <p className="text-text-muted text-sm leading-relaxed">
          A personal assistant that listens, remembers the people who matter,
          and speaks up before you forget.
        </p>
        <p className="text-text-faint font-mono text-xs">
          {readyCount} of {subsystems.length} subsystems ready
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-text-faint mb-1 text-xs font-medium tracking-widest uppercase">
          Build status
        </h2>
        <ul className="flex flex-col gap-2">
          {subsystems.map((s) => (
            <li
              key={s.part}
              className="border-border bg-surface flex items-center gap-4 rounded-lg border px-4 py-3"
            >
              <span className="text-text-faint w-10 shrink-0 font-mono text-xs">
                {String(s.part).padStart(2, "0")}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{s.name}</span>
                <span className="text-text-muted truncate text-xs">
                  {s.detail}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[s.status]}`}
              >
                {STATUS_LABEL[s.status]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-border flex items-center justify-between border-t pt-6">
        <span className="text-text-faint text-xs">
          See <span className="font-mono">planning.md</span> for the
          architecture and decision log.
        </span>
        {configured.llm() && (
          <Link
            href="/"
            className="bg-accent text-accent-contrast rounded-lg px-3 py-1.5 text-xs font-medium"
          >
            Open assistant
          </Link>
        )}
      </footer>
    </main>
  );
}
