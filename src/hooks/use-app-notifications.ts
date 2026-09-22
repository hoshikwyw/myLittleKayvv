"use client";

import { useEffect } from "react";
import { isNativeShell } from "@/lib/native/platform";

/**
 * Registers this phone for reminder notifications, in the Android app only.
 *
 * On every start: make sure the "Reminders" channel exists, ask for permission
 * if it has not been decided, and hand Firebase's token to the server. Every
 * start rather than once, because Firebase rotates tokens and the server only
 * ever knows the last one it was told.
 *
 * Nothing here runs in a browser. The plugin is imported lazily for the same
 * reason as the others — it touches `window` as it loads — and so a browser
 * visitor never downloads it at all.
 */

/** The token this phone registered, so signing out can take it back. */
let registeredToken: string | null = null;

export function useAppNotifications(): void {
  useEffect(() => {
    if (!isNativeShell()) return;

    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    void (async () => {
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
          registeredToken = value;
          void fetch("/api/devices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: value, platform: "android" }),
          }).catch(() => {
            // Offline right now; the next start registers again.
          });
        }),
        await PushNotifications.addListener("registrationError", (error) => {
          console.warn("Push registration failed:", error.error);
        }),
      );

      let { receive } = await PushNotifications.checkPermissions();
      // Asked once, when the app first opens. After a "no", Android will not
      // show the dialog again; the setting lives in the phone's app settings.
      if (receive === "prompt" || receive === "prompt-with-rationale") {
        ({ receive } = await PushNotifications.requestPermissions());
      }
      if (cancelled || receive !== "granted") return;

      await PushNotifications.register();
    })().catch((error: unknown) => {
      console.warn("Could not set up notifications:", error);
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
