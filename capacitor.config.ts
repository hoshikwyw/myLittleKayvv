import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android app is a native shell around the deployed site.
 *
 * Capacitor normally bundles a static build into the APK. Kayv cannot be one:
 * it has a password gate, streams its replies over SSE, and reads the database
 * on the server — none of which can run inside a phone's WebView. So the shell
 * loads the live deployment instead, and every fix pushed to Vercel reaches the
 * phone without a reinstall.
 *
 * Capacitor's documentation says `server.url` is "not intended for use in
 * production", and gives its reasons: a slower first load, and no fallback when
 * the server cannot be reached. Neither changes the decision for an assistant
 * that needs the network to do anything at all, but the second deserves an
 * answer, which is `errorPath` below.
 *
 * The URL is read from `mobile/www/app-url.json` rather than written here,
 * because the offline screen needs it too, to know where "try again" goes. One
 * file means the two can never disagree about where the app lives.
 */

/*
 * Resolved from the working directory rather than `import.meta.url`. The
 * Capacitor CLI compiles this file to CommonJS before running it, and an
 * `import.meta` left in that output makes Node treat it as an ES module —
 * which then fails on the `exports` the compiler wrote. The CLI always runs
 * from the project root, where this file has to live anyway.
 */
const { url } = JSON.parse(
  readFileSync(join(process.cwd(), "mobile", "www", "app-url.json"), "utf8"),
) as { url: string };

const config: CapacitorConfig = {
  appId: "com.mylittlekayv.app",
  appName: "Kayv",
  webDir: "mobile/www",

  server: {
    url,

    /*
     * Shown instead of Android's own "webpage not available" error when the
     * deployment cannot be reached — no signal, or Vercel down. Resolved
     * against webDir, so it is bundled into the APK and works offline.
     */
    errorPath: "offline.html",

    /*
     * Only the app's own address opens inside the shell.
     *
     * Everything else — a news source from a search, a Google Maps link — is
     * handed to the phone's browser. Inside the shell there is no address bar
     * and no way back, so an outside page opened there would strand you on it.
     */
    allowNavigation: [new URL(url).host],
  },

  android: {
    // The HUD's own background, so the moment before the page paints is dark
    // rather than a white flash.
    backgroundColor: "#04070d",
  },
};

export default config;
