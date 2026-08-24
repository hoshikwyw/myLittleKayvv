import Link from "next/link";
import { ChatPanel } from "@/components/chat-panel";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-accent size-2 rounded-full" aria-hidden="true" />
          <span className="text-sm font-medium">{env.assistantName}</span>
        </div>
        <Link
          href="/"
          className="text-text-faint hover:text-text text-xs transition-colors"
        >
          status
        </Link>
      </header>

      <ChatPanel />
    </div>
  );
}
