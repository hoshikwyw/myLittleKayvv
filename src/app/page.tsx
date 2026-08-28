import { AssistantShell } from "@/components/assistant-shell";
import { configured, env } from "@/lib/env";
import { loadDailyBrief, type DailyBrief } from "@/lib/memory/brief";

export const dynamic = "force-dynamic";

export default async function Home() {
  // The brief is a nicety, not the product. If the database is unreachable the
  // assistant must still open, so a failure here is swallowed rather than
  // turned into an error page.
  let brief: DailyBrief | null = null;

  if (configured.database()) {
    brief = await loadDailyBrief().catch(() => null);
  }

  return (
    <AssistantShell
      assistantName={env.assistantName}
      memoryReady={configured.database()}
      brief={brief}
    />
  );
}
