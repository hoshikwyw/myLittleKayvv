import { configured, env } from "@/lib/env";
import type { DeliveryResult, NotificationChannel } from "./types";

/**
 * Email via Resend, over plain fetch rather than their SDK — one HTTP call does
 * not justify a dependency.
 *
 * This is the fallback, not the primary. Email is easy to miss, and "her
 * birthday is tomorrow" deserves better than sitting between two receipts.
 */
export class EmailChannel implements NotificationChannel {
  readonly name = "email" as const;

  isConfigured(): boolean {
    return configured.email() && Boolean(env.reminderEmailTo);
  }

  async send(subject: string, body: string): Promise<DeliveryResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Resend's shared sender, so this works before a domain is verified.
          from: `${env.assistantName} <onboarding@resend.dev>`,
          to: [env.reminderEmailTo],
          subject,
          text: body,
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
      } | null;

      if (!response.ok) {
        return {
          channel: this.name,
          ok: false,
          error: data?.message ?? `Resend returned ${response.status}`,
        };
      }

      return { channel: this.name, ok: true };
    } catch (error) {
      return {
        channel: this.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
