import { z } from "zod";
import { env } from "@/lib/env";
import { defineTool } from "./types";

/**
 * Google Calendar, read-only.
 *
 * Single-user (decision D1), so a long-lived refresh token held in the
 * environment beats building a consent screen, a redirect handler, and token
 * storage for an audience of one. If this ever becomes multi-user, that flow
 * gets built and this file changes shape — the tool contract does not.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

/**
 * Access tokens last about an hour. Caching one avoids a token round trip on
 * every single call, which matters against a 30s function ceiling.
 */
async function getAccessToken(signal?: AbortSignal): Promise<string> {
  // A minute of headroom, so a token cannot expire mid-request.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleOauthClientId,
      client_secret: env.googleOauthClientSecret,
      refresh_token: env.googleOauthRefreshToken,
      grant_type: "refresh_token",
    }),
    signal,
  });

  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  } | null;

  if (!response.ok || !data?.access_token) {
    cached = null;
    throw new Error(
      data?.error_description ??
        data?.error ??
        "Could not refresh Google Calendar access. The refresh token may have been revoked.",
    );
  }

  cached = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return cached.accessToken;
}

interface CalendarEvent {
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
}

/** All-day events carry `date`; timed ones carry `dateTime`. */
function describeStart(event: CalendarEvent, timezone: string): string {
  const allDay = Boolean(event.start?.date);
  const raw = event.start?.dateTime ?? event.start?.date;
  if (!raw) return "unknown time";

  const when = new Date(allDay ? `${raw}T12:00:00Z` : raw);

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(allDay ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(when);
}

export const readCalendar = defineTool({
  name: "read_calendar",
  description:
    "Read the user's Google Calendar for a window of days ahead. Use this for " +
    "anything about meetings, appointments, or what their day looks like. " +
    "This is read-only — you cannot create or move events, so say so plainly " +
    "if asked to.",
  schema: z.object({
    days_ahead: z
      .number()
      .int()
      .min(0)
      .max(60)
      .default(7)
      .describe("How far ahead to look. 0 means the rest of today."),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  handler: async ({ days_ahead, limit }, { now, signal }) => {
    const token = await getAccessToken(signal);

    const timeMax = new Date(now.getTime() + (days_ahead + 1) * 86_400_000);

    const url = new URL(EVENTS_ENDPOINT);
    url.searchParams.set("timeMin", now.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("maxResults", String(limit));
    // Expand recurring events into occurrences, otherwise a weekly standup
    // comes back as one rule rather than the meeting that is actually next.
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });

    const data = (await response.json().catch(() => null)) as {
      items?: CalendarEvent[];
      error?: { message?: string };
    } | null;

    if (!response.ok) {
      // A 401 means the cached token is stale or revoked; drop it so the next
      // attempt refreshes rather than replaying a dead token.
      if (response.status === 401) cached = null;
      throw new Error(
        data?.error?.message ?? `Calendar request failed (${response.status})`,
      );
    }

    const events = data?.items ?? [];

    return {
      count: events.length,
      daysAhead: days_ahead,
      events: events.map((event) => ({
        what: event.summary ?? "(no title)",
        when: describeStart(event, env.timezone),
        allDay: Boolean(event.start?.date),
        where: event.location,
        url: event.htmlLink,
      })),
    };
  },
});
