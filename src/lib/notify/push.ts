import { env } from "@/lib/env";
import { escapeHtml } from "./telegram";

/**
 * Sending something to the owner's phone, now, because they asked.
 *
 * Distinct from `NotificationChannel`, which exists for reminders the *system*
 * decides to send. This is the assistant doing what it was told, and it needs
 * two things the reminder path does not: a real map pin, and no subject line.
 *
 * There is one recipient and it is not a parameter. The chat id comes from the
 * environment, so no amount of persuading the model can address a message to
 * anybody else.
 */

export interface PushResult {
  ok: boolean;
  error?: string;
}

async function call(
  method: string,
  payload: Record<string, unknown>,
): Promise<PushResult> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.telegramBotToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.telegramChatId, ...payload }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;

    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.description ?? `Telegram returned ${response.status}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function pushText(text: string): Promise<PushResult> {
  return call("sendMessage", {
    text: escapeHtml(text),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/**
 * A place, as a tappable pin.
 *
 * `sendVenue` rather than `sendLocation`: a bare location is a dot with no
 * label, and the whole point of sending somewhere is that it arrives saying
 * what it is. Telegram requires both a title and an address for a venue, so a
 * place with no address gets its coordinates as one rather than being
 * downgraded to an anonymous dot.
 */
export async function pushPlace(place: {
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
}): Promise<PushResult> {
  return call("sendVenue", {
    latitude: place.latitude,
    longitude: place.longitude,
    title: place.name,
    address:
      place.address?.trim() ||
      `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`,
  });
}
