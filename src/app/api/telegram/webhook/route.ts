import { configured, env } from "@/lib/env";
import { isOwner, respondTo } from "@/lib/telegram/handle";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Telegram's webhook.
 *
 * This URL is public and its address is the only thing standing between a
 * stranger and someone's private assistant, so it is guarded twice: Telegram's
 * own secret header, and a check that the message came from the owner's chat.
 * Either alone would be too thin.
 */

interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
  edited_message?: unknown;
}

function secretMatches(request: Request): boolean {
  const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expected = env.telegramWebhookSecret;

  if (!expected || provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(request: Request) {
  if (!configured.telegram() || !env.telegramWebhookSecret) {
    return Response.json({ error: "Telegram is not configured" }, { status: 503 });
  }

  if (!secretMatches(request)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const update = (await request
    .json()
    .catch(() => null)) as TelegramUpdate | null;

  const text = update?.message?.text;
  const chatId = update?.message?.chat?.id;

  // Everything else — edits, joins, stickers, channel posts — is acknowledged
  // and ignored. Telegram retries anything it does not get a 200 for.
  if (!text || chatId === undefined) return Response.json({ ok: true });

  if (!isOwner(String(chatId))) {
    // Deliberately silent. Replying would confirm the bot is live to whoever
    // found it, and there is nothing useful to say to a stranger.
    return Response.json({ ok: true });
  }

  try {
    await respondTo({ chatId: String(chatId), text, updateId: update?.update_id });
  } catch {
    // Always 200: a non-200 makes Telegram redeliver the same update, which
    // would repeat whatever half-finished thing just failed.
  }

  return Response.json({ ok: true });
}
