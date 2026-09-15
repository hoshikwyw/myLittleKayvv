import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kayv",
  description: "A personal assistant that listens, remembers, and reminds.",
};

/**
 * The only literal colours in the app.
 *
 * The browser paints its chrome from this before any stylesheet loads, so it
 * cannot read a CSS variable. These must be kept in step with `--bg` in
 * globals.css by hand — when they drift, a phone shows a visible seam between
 * the browser bar and the page.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef4f8" },
    { media: "(prefers-color-scheme: dark)", color: "#04070d" },
  ],

  /*
   * Draw under the status bar and the gesture bar, as the Android app must.
   *
   * Android 15 makes every app edge-to-edge whether it asks or not, so the
   * choice is only between the page knowing it and the page being covered.
   * With `cover`, the insets are reported to CSS and the workspace pads itself
   * clear of them — see the `--safe-*` tokens in globals.css.
   */
  viewportFit: "cover",

  /*
   * When the keyboard opens, shrink the page rather than sliding the keyboard
   * over it. The workspace is a fixed-height column with the message box at
   * the bottom of its panel; overlaid, the box you are typing into is the thing
   * the keyboard hides.
   */
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /**
     * Browser extensions write their own attributes onto the two outermost
     * elements before React hydrates — `data-hwp-extension` on <html>,
     * `cz-shortcut-listen` on <body> — and React reports each as a
     * server/client mismatch. Nothing in our markup is wrong and there is
     * nothing to fix, so the warning is suppressed here.
     *
     * `suppressHydrationWarning` covers only the element's own attributes and
     * text, never its descendants, so this stays confined to the two elements
     * extensions actually touch. Everything rendered inside still reports
     * normally — which is how a genuine mismatch in the reactor's tick marks
     * was caught rather than hidden.
     */
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/*
        `h-full` and clipped, not `min-h-full`.
        
        A minimum height only ever grows: it lets the document run past the
        bottom of the window and hands the page a scrollbar, which is what put
        the world map below the fold. Fixing the height here is what makes the
        workspace's `min-h-0` columns mean anything — without a bounded
        ancestor, "share the space available" has no space to share.

        `dvh` rather than `vh` so a mobile browser's collapsing address bar
        does not leave a strip of the interface underneath it.
      */}
      <body
        className="bg-bg text-text flex h-full max-h-dvh flex-col overflow-hidden font-sans"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
