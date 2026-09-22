import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { devices } from "@/db/schema";
import { configured, env } from "@/lib/env";
import { FcmClient, parseServiceAccount, type SendResult } from "./fcm";
import type { DeliveryResult, NotificationChannel } from "./types";

/**
 * A notification on the phone, from the Android app itself.
 *
 * Sent to every phone that has registered, since one person may have the app
 * on more than one. Delivered if any of them accepted it. Tokens Firebase
 * reports as gone — the app uninstalled, its data cleared — are deleted here,
 * so a dead phone stops being tried rather than failing every sweep forever.
 */

export interface DeviceStore {
  tokens(): Promise<string[]>;
  remove(tokens: string[]): Promise<void>;
}

export interface Sender {
  send(token: string, title: string, body: string): Promise<SendResult>;
}

const databaseDevices: DeviceStore = {
  async tokens() {
    const rows = await getDb().select({ token: devices.token }).from(devices);
    return rows.map((r) => r.token);
  },
  async remove(tokens) {
    if (tokens.length === 0) return;
    await getDb().delete(devices).where(inArray(devices.token, tokens));
  },
};

let client: FcmClient | undefined;

function fcm(): FcmClient {
  // One client per server instance, so its access token is reused across
  // sweeps instead of signed afresh for every message.
  client ??= new FcmClient(parseServiceAccount(env.firebaseServiceAccount));
  return client;
}

export class AppPushChannel implements NotificationChannel {
  readonly name = "app" as const;

  constructor(
    private readonly store: DeviceStore = databaseDevices,
    private readonly sender: () => Sender = fcm,
  ) {}

  isConfigured(): boolean {
    return configured.appPush();
  }

  async send(subject: string, body: string): Promise<DeliveryResult> {
    try {
      const tokens = await this.store.tokens();
      if (tokens.length === 0) {
        return {
          channel: this.name,
          ok: false,
          error: "No phone has registered. Open the Android app once and allow notifications.",
        };
      }

      const sender = this.sender();
      const results = await Promise.all(
        tokens.map(async (token) => ({
          token,
          result: await sender.send(token, subject, body),
        })),
      );

      const gone = results
        .filter(({ result }) => !result.ok && result.gone)
        .map(({ token }) => token);
      await this.store.remove(gone).catch(() => {
        // Tidying up must not turn a delivered reminder into a failed one.
      });

      if (results.some(({ result }) => result.ok)) {
        return { channel: this.name, ok: true };
      }

      const first = results.find(({ result }) => !result.ok)?.result;
      return {
        channel: this.name,
        ok: false,
        error:
          first && !first.ok
            ? gone.length === tokens.length
              ? `Every registered phone is gone (${first.error}). Open the app again to re-register.`
              : first.error
            : "Nothing was delivered.",
      };
    } catch (error) {
      return {
        channel: this.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** Records a phone's token, or refreshes when it was last seen. */
export async function registerDevice(token: string, platform: string): Promise<void> {
  await getDb()
    .insert(devices)
    .values({ token, platform })
    .onConflictDoUpdate({
      target: devices.token,
      set: { lastSeenAt: new Date(), platform },
    });
}

/** Forgets a phone, when the app signs out. */
export async function unregisterDevice(token: string): Promise<void> {
  await getDb().delete(devices).where(eq(devices.token, token));
}
