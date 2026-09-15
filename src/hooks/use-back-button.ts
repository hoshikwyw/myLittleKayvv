"use client";

import { useEffect, useRef } from "react";
import { handleBack, registerBack } from "@/lib/native/back-stack";

/**
 * Lets Android's back button close this, while it is open.
 *
 * Does nothing in a browser, where the stack is simply never consulted. The
 * handler is held in a ref so a component re-rendering while open does not
 * unregister and re-register itself on every render — which would reorder it
 * relative to whatever opened on top of it in the meantime.
 */
export function useBackToClose(open: boolean, close: () => void): void {
  const closeRef = useRef(close);

  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    return registerBack(() => closeRef.current());
  }, [open]);
}

/**
 * Wires the hardware back button, once, for the whole app.
 *
 * Only inside the Android shell. Imported lazily because `@capacitor/core`
 * reads `window` as soon as it loads, and this module is also rendered on the
 * server, where there is no window to read.
 *
 * With nothing open, back minimises rather than exits. Exiting would throw the
 * app away, and reopening it would mean loading the whole thing from Vercel
 * again; minimised, it comes back exactly where it was — which is what back
 * does at the top of any Android app that holds state.
 */
export function useNativeBackButton(): void {
  useEffect(() => {
    let removed = false;
    let remove: (() => void) | undefined;

    void (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const { App } = await import("@capacitor/app");

      const listener = await App.addListener("backButton", () => {
        if (!handleBack()) void App.minimizeApp();
      });

      // The component may have unmounted while the imports were loading.
      if (removed) void listener.remove();
      else remove = () => void listener.remove();
    })();

    return () => {
      removed = true;
      remove?.();
    };
  }, []);
}
