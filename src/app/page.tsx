import { HudWorkspace } from "@/components/hud/workspace";
import { configured, env } from "@/lib/env";
import { loadMemoryOverview, type MemoryOverview } from "@/lib/memory/overview";

export const dynamic = "force-dynamic";

/** Nothing stored yet, or no database — the workspace still has to render. */
const EMPTY: MemoryOverview = {
  people: [],
  upcoming: [],
  plans: [],
  looseFacts: [],
  counts: { people: 0, dates: 0, facts: 0, plans: 0 },
};

export default async function Home() {
  const overview = configured.database()
    ? await loadMemoryOverview().catch(() => EMPTY)
    : EMPTY;

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  return (
    <HudWorkspace
      assistantName={env.assistantName}
      overview={overview}
      status={{
        llm: configured.llm(),
        database: configured.database(),
        maps: configured.maps(),
        search: configured.search(),
        calendar: configured.calendar(),
        telegram: configured.telegram(),
      }}
      model={env.geminiModel}
      timezone={env.timezone}
      today={today}
    />
  );
}
