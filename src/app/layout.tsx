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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-bg text-text flex min-h-full flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
