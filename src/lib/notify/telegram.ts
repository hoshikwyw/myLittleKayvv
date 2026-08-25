import { configured, env } from "@/lib/env";
import type { DeliveryResult, NotificationChannel } from "./types";

/**
 * Telegram Bot API.
 *
 * The primary channel: free, no rate limit worth worrying about at one message
 * a day, reaches a phone whether or not the app is open, and needs no push
 * infrastructure of our own.
 */
export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram" as const;

  isConfigured(): boolean {
    return configured.telegram();
  }

  async send(subject: string, body: string): Promise<DeliveryResult> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.telegramChatId,
            text: `<b>${escapeHtml(subject)}</b>\n\n${escapeHtml(body)}`,
            parse_mode: "HTML",
            // A birthday reminder does not need a link preview card.
            link_preview_options: { is_disabled: true },
          }),
        },
      );

      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        description?: string;
      } | null;

      if (!response.ok || !data?.ok) {
        return {
          channel: this.name,
          ok: false,
          error: data?.description ?? `Telegram returned ${response.status}`,
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

/**
 * HTML mode rather than MarkdownV2, deliberately.
 *
 * MarkdownV2 requires eighteen characters escaped anywhere in the message, and
 * missing any one of them makes Telegram reject the whole thing — a surname
 * with a hyphen would be enough to lose a reminder silently. HTML mode needs
 * exactly three, which is a rule that can be got right and stay right.
 *
 * The ampersand must be replaced first, or the entities introduced by the next
 * two replacements get escaped a second time.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
