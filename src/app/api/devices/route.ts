import { configured } from "@/lib/env";
import { registerDevice, unregisterDevice } from "@/lib/notify/app";

export const dynamic = "force-dynamic";

/**
 * Where the Android app reports the token Firebase gave it.
 *
 * Behind the app password like every other route (see src/proxy.ts): the app
 * is signed in, and its WebView sends the session cookie with this request. A
 * stranger cannot register a phone to receive your reminders.
 */

/** Firebase tokens are around 160 characters; allow room, refuse nonsense. */
function readToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < 20 || token.length > 4096) return null;
  if (!/^[A-Za-z0-9_:\-.]+$/.test(token)) return null;
  return token;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  return ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

export async function POST(request: Request) {
  if (!configured.database()) {
    return Response.json({ error: "No database" }, { status: 503 });
  }

  const data = await body(request);
  const token = readToken(data.token);
  if (!token) {
    return Response.json({ error: "A device token is required" }, { status: 400 });
  }

  const platform = data.platform === "ios" ? "ios" : "android";
  await registerDevice(token, platform);

  return Response.json({ ok: true, push: configured.appPush() });
}

export async function DELETE(request: Request) {
  if (!configured.database()) {
    return Response.json({ error: "No database" }, { status: 503 });
  }

  const token = readToken((await body(request)).token);
  if (!token) {
    return Response.json({ error: "A device token is required" }, { status: 400 });
  }

  await unregisterDevice(token);
  return Response.json({ ok: true });
}
