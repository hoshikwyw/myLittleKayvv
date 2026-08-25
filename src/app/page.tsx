import { AssistantShell } from "@/components/assistant-shell";
import { configured, env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <AssistantShell
      assistantName={env.assistantName}
      memoryReady={configured.database()}
    />
  );
}
