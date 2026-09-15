/**
 * Whether this page is running inside the Android app.
 *
 * The app's native layer writes `window.Capacitor` into the page before any of
 * the page's own scripts run, so the answer is available synchronously — which
 * matters for choosing a voice adapter during the first render. Reading the
 * global rather than importing `@capacitor/core` keeps this safe on the server
 * and free for every browser visitor, who never needs that package at all.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;

  const capacitor = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}
