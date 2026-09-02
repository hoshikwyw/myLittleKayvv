import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

/**
 * The gate.
 *
 * `proxy.ts`, not `middleware.ts` — the middleware convention is deprecated in
 * Next 16 and renamed, with the same behaviour.
 *
 * Everything is closed by default. New routes are added often and a list of
 * things to protect is a list somebody eventually forgets to add to; a list of
 * things to leave open is short, and each entry has to justify itself.
 */

/**
 * The only paths that answer without a session, and why each one has to.
 *
 * Both of the API routes here already authenticate themselves, with a shared
 * secret rather than a cookie, because the callers are machines that have no
 * way to log in.
 */
const PUBLIC = [
  // The login page, or there would be nowhere to log in.
  "/login",
  "/api/login",
  // Vercel Cron calls this with the cron secret in an Authorization header.
  "/api/cron/",
  // Telegram calls this with the webhook secret in a header it was given.
  "/api/telegram/",
  /*
   * Health, which authenticates itself and is meant to be reachable by
   * machines — an uptime check has no session and never will.
   *
   * Safe because the route was built for exactly this: without the cron
   * secret it answers `{ ok: true }` and nothing else, because an
   * unauthenticated inventory of someone's integrations is free
   * reconnaissance. Behind the session it was simply unreachable, and its
   * two-tier design was dead code.
   */
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC.some(
    (path) => pathname === path || pathname.startsWith(path),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const secret = process.env.APP_PASSWORD;

  /*
   * No password set, no gate.
   *
   * This is for local development, where the app runs on localhost and a login
   * screen is only friction. It is also exactly the mistake that would expose
   * everything in production, so the deploy checklist treats APP_PASSWORD as
   * required and `/api/health` reports whether it is set.
   */
  if (!secret) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token, secret)) return NextResponse.next();

  // An API call gets a status it can act on. Redirecting a fetch to an HTML
  // login page gives the browser a 200 full of markup, which fails somewhere
  // far away from the actual cause.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Not signed in" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const login = new URL("/login", request.url);
  // Come back to where they were headed once they are in.
  login.searchParams.set("next", pathname);

  return NextResponse.redirect(login);
}

export const config = {
  /*
   * Everything except Next's own static output and the icons.
   *
   * Without a matcher this runs on every request including `_next/static`,
   * which would put a redirect in front of the CSS and leave the login page
   * itself unstyled.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
