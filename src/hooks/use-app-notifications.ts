"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isNativeShell } from "@/lib/native/platform";

/**
 * Registers this phone for reminder notifications, in the Android app only.
 *
 * On every start: make sure the "Reminders" channel exists, ask for permission
 * if it has not been decided, and hand Firebase's token to the server. Every
 * start rather than once, because Firebase rotates tokens and the server only
 * ever knows the last one it was told.
 *
 * Every step reports how it went, and the System panel shows it. Registration
 * happens on the phone, out of sight of the server — so when it failed, the
 * only symptom was a reminder that never arrived, with nothing on either side
 * to say which step had gone wrong.
 *
 * Nothing here runs in a browser. The plugin is imported lazily for the same
 * reason as the others — it touches `window` as it loads — and so a browser
 * visitor never downloads it at all.
 */

/** Where registration got to on this phone. Null outside the Android app. */
export type PhoneNotificationStatus =
  | { step: "starting" }
  | { step: "denied" }
  | { step: "registering" }
  | { step: "failed"; reason: string }
  | { step: "registered" };

let status: PhoneNotificationStatus | null = null;
const listeners = new Set<() => void>();

function report(next: PhoneNotificationStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How registration went on this phone, for the System panel. */
export function usePhoneNotificationStatus(): PhoneNotificationStatus | null {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => null,
  );
}

/** The token this phone registered, so signing out can take it back. */
let registeredToken: string | null = null;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}

async function saveToken(token: string): Promise<void> {
  try {
    const response = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: "android" }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      report({
        step: "failed",
        reason: `The server refused the phone (${response.status}${data?.error ? `: ${data.error}` : ""}).`,
      });
      return;
    }

    registeredToken = token;
    report({ step: "registered" });
  } catch (error) {
    report({
      step: "failed",
      reason: `Could not reach the server: ${messageOf(error)}`,
    });
  }
}

export function useAppNotifications(): void {
  useEffect(() => {
    if (!isNativeShell()) return;

    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    void (async () => {
      report({ step: "starting" });

      const { PushNotifications } = await import("@capacitor/push-notifications");

      /*
       * Android 8+ files every notification under a channel, and the channel's
       * importance is what decides whether it pops up on screen or waits
       * silently in the shade. Five is "urgent": sound, and a heads-up banner —
       * what a reminder is for. The id matches the one the server sends.
       */
      await PushNotifications.createChannel({
        id: "reminders",
        name: "Reminders",
        description: "Plans starting soon, and the morning digest of birthdays.",
        importance: 5,
        visibility: 1,
        vibration: true,
      }).catch(() => {});

      handles.push(
        await PushNotifications.addListener("registration", ({ value }) => {
          void saveToken(value);
        }),
        await PushNotifications.addListener("registrationError", (error) => {
          report({
            step: "failed",
            reason: `Firebase could not register this phone: ${messageOf(error.error)}`,
          });
        }),
      );

      let { receive } = await PushNotifications.checkPermissions();
      // Asked once, when the app first opens. After a "no", Android will not
      // show the dialog again; the setting lives in the phone's app settings.
      if (receive === "prompt" || receive === "prompt-with-rationale") {
        ({ receive } = await PushNotifications.requestPermissions());
      }
      if (cancelled) return;
      if (receive !== "granted") {
        report({ step: "denied" });
        return;
      }

      report({ step: "registering" });
      await PushNotifications.register();
    })().catch((error: unknown) => {
      report({ step: "failed", reason: messageOf(error) });
    });

    return () => {
      cancelled = true;
      for (const handle of handles) void handle.remove();
    };
  }, []);
}

/**
 * Stops this phone receiving reminders, before signing out.
 *
 * Signed out, the app cannot show anything, so a notification tapped there
 * would open a login screen — and the reminders are for whoever is signed in.
 */
export async function forgetThisPhone(): Promise<void> {
  if (!registeredToken) return;

  const token = registeredToken;
  registeredToken = null;
  await fetch("/api/devices", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => {});
}
