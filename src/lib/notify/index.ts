import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { AppPushChannel } from "./app";
import { EmailChannel } from "./email";
import { TelegramChannel } from "./telegram";
import type { DeliveryResult, NotificationChannel } from "./types";

/**
 * Where a reminder goes.
 *
 * Every primary channel gets it: Telegram, and the Android app's own
 * notification. The owner asked for both — the app for a proper notification
 * on the phone, Telegram because it reaches anywhere they are signed in.
 *
 * Email is different. It is only a fallback, tried when no primary channel
 * delivered, so that an unconfigured bot or a lost phone does not mean a
 * birthday passes in silence — without adding a third copy every day.
 */
const PRIMARY: NotificationChannel[] = [
  new TelegramChannel(),
  new AppPushChannel(),
];
const FALLBACK: NotificationChannel[] = [new EmailChannel()];

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

/**
 * Sends to every configured primary channel at once, then to the fallbacks in
 * order, stopping at the first that delivers — only if no primary did.
 *
 * Exported with its channels and its recorder as parameters so the rule can be
 * tested without a bot, a phone or a database.
 */
export async function deliver(
  primary: NotificationChannel[],
  fallback: NotificationChannel[],
  subject: string,
  body: string,
  record: (result: DeliveryResult) => Promise<void>,
): Promise<NotifyOutcome> {
  // In parallel: a slow Firebase must not hold up the Telegram message, and
  // the whole sweep has thirty seconds.
  const attempts = await Promise.all(
    primary
      .filter((channel) => channel.isConfigured())
      .map((channel) => channel.send(subject, body)),
  );
  await Promise.all(attempts.map(record));

  if (attempts.some((a) => a.ok)) return { delivered: true, attempts };

  for (const channel of fallback) {
    if (!channel.isConfigured()) continue;

    const result = await channel.send(subject, body);
    attempts.push(result);
    await record(result);

    if (result.ok) return { delivered: true, attempts };
  }

  return { delivered: false, attempts };
}

export async function notify({
  subject,
  body,
  importantDateId,
  planId,
}: NotifyOptions): Promise<NotifyOutcome> {
  return deliver(PRIMARY, FALLBACK, subject, body, (result) =>
    recordAttempt(result, body, importantDateId, planId),
  );
}

export function configuredChannels(): string[] {
  return [...PRIMARY, ...FALLBACK]
    .filter((c) => c.isConfigured())
    .map((c) => c.name);
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
