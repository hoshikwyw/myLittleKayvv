"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The way in.
 *
 * Deliberately says nothing about what is behind it. A login screen listing
 * the owner's name, or the people the assistant remembers, would leak the
 * thing the password exists to protect to anyone who loads the page.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !password) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(detail?.error ?? "That did not work.");
        setPassword("");
        return;
      }

      // Only ever back inside this app. A `next` of "https://elsewhere" would
      // otherwise turn the login into an open redirect.
      const next = params.get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <form
        onSubmit={submit}
        className="hud-frame glass relative flex w-full max-w-sm flex-col gap-4 rounded-sm border p-6"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="text-accent size-4" />
          <h1 className="hud-label text-text-muted !tracking-[0.2em]">
            Kayv
          </h1>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="hud-label">password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            className={cn(
              "border-border bg-surface/60 rounded-sm border px-3 py-2 text-sm outline-none",
              "focus:border-accent focus:shadow-[0_0_16px_-6px_var(--accent)] transition-shadow",
            )}
          />
        </label>

        {error && (
          <p className="text-danger text-xs" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="border-accent/60 text-accent flex items-center justify-center gap-2 rounded-sm border px-3 py-2 text-[11px] tracking-wide uppercase transition-all hover:brightness-125 active:scale-[0.99] disabled:opacity-30"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--accent) 16%, transparent), transparent)",
          }}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? "checking" : "sign in"}
        </button>
      </form>
    </main>
  );
}
