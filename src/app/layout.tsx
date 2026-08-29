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
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#080b11" },
  ],
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
      <body
        className="bg-bg text-text flex min-h-full flex-col font-sans"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
