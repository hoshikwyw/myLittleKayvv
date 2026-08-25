import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { EmailChannel } from "./email";
import { TelegramChannel } from "./telegram";
import type { DeliveryResult, NotificationChannel } from "./types";

/**
 * Delivery, in preference order.
 *
 * Telegram first because it reaches a phone and gets read. Email only if
 * Telegram is unconfigured or fails — a fallback, not a second copy. Being told
 * twice about the same birthday trains you to ignore both.
 */
const CHANNELS: NotificationChannel[] = [
  new TelegramChannel(),
  new EmailChannel(),
];

export interface NotifyOptions {
  subject: string;
  body: string;
  /** Recorded on the notification row so failures can be traced back. */
  importantDateId?: string;
  planId?: string;
}

export interface NotifyOutcome {
  delivered: boolean;
  attempts: DeliveryResult[];
}

export async function notify({
  subject,
  body,
  importantDateId,
  planId,
}: NotifyOptions): Promise<NotifyOutcome> {
  const attempts: DeliveryResult[] = [];

  for (const channel of CHANNELS) {
    if (!channel.isConfigured()) continue;

    const result = await channel.send(subject, body);
    attempts.push(result);

    await recordAttempt(result, body, importantDateId, planId);

    // Stop at the first success. The rest are fallbacks, not copies.
    if (result.ok) return { delivered: true, attempts };
  }

  return { delivered: false, attempts };
}

export function configuredChannels(): string[] {
  return CHANNELS.filter((c) => c.isConfigured()).map((c) => c.name);
}

/**
 * The audit trail. Without it, "did it send?" is unanswerable, and a reminder
 * system you cannot audit is one you cannot trust.
 */
async function recordAttempt(
  result: DeliveryResult,
  body: string,
  importantDateId?: string,
  planId?: string,
): Promise<void> {
  try {
    await getDb().insert(notifications).values({
      channel: result.channel,
      status: result.ok ? "sent" : "failed",
      body,
      error: result.error,
      importantDateId,
      planId,
    });
  } catch {
    // Logging must never be the reason a reminder fails to go out.
  }
}

export type { DeliveryResult, NotificationChannel } from "./types";
