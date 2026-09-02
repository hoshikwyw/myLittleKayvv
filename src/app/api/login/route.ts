import { z } from "zod";
import { createSession, passwordMatches, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Signing in, and out.
 *
 * There is one password and no account, so this is a string comparison and a
 * cookie. The care that would normally go into a user table goes here instead:
 * the comparison is constant time, the failure says nothing useful, and a wrong
 * attempt costs a second so the whole thing cannot be walked through quickly.
 */

const LoginSchema = z.object({ password: z.string().min(1).max(200) });

/**
 * A deliberate second, on failure only.
 *
 * The password is a single secret with no lockout behind it. Unthrottled, a
 * script could try it thousands of times a minute; at one attempt a second the
 * cost of guessing anything worth using rises past any patience.
 */
const WRONG_PASSWORD_DELAY_MS = 1000;

export async function POST(request: Request) {
  const secret = process.env.APP_PASSWORD;

  if (!secret) {
    return Response.json(
      { error: "No password is set, so there is nothing to sign in to." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);

  if (!parsed.success || !(await passwordMatches(parsed.data.password, secret))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));

    // One message for a malformed body and for a wrong password alike. Telling
    // them apart tells an attacker which half they got right.
    return Response.json({ error: "That is not the password." }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  const cookie = sessionCookie(await createSession(secret));

  response.headers.append(
    "Set-Cookie",
    [
      `${cookie.name}=${cookie.value}`,
      `Path=${cookie.path}`,
      `Max-Age=${cookie.maxAge}`,
      "HttpOnly",
      `SameSite=${cookie.sameSite === "lax" ? "Lax" : "Strict"}`,
      cookie.secure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );

  return response;
}

/** Signing out: the same cookie, already expired. */
export async function DELETE() {
  const response = Response.json({ ok: true });

  response.headers.append(
    "Set-Cookie",
    `kayv_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );

  return response;
}
