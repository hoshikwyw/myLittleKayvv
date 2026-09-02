import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/**
 * Getting a Google Calendar refresh token, once.
 *
 * The token itself is the only hard part of connecting a calendar, and every
 * guide to it ends in hand-assembled curl commands, a code pasted between two
 * terminals, and a URL-encoding mistake. This does the whole consent flow: it
 * opens the browser, catches the redirect on a local port, exchanges the code,
 * and writes the token into .env.local.
 *
 * Read-only scope, deliberately. Kayv reads what is on your calendar and has
 * no business writing to it, and a token that cannot write is a token that
 * cannot ruin your week if it leaks.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/**
 * Google requires the redirect URI to match the one registered exactly.
 * A fixed loopback port is the simplest thing to register and to explain.
 */
const PORT = 5174;
const REDIRECT = `http://localhost:${PORT}/callback`;

function loadEnvLocal(): Record<string, string> {
  const values: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Handled by the caller, which needs the client id anyway.
  }
  return values;
}

/** Writes one variable back, replacing it in place rather than appending. */
function saveToEnvLocal(key: string, value: string): void {
  const contents = readFileSync(".env.local", "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "m");

  writeFileSync(
    ".env.local",
    pattern.test(contents)
      ? contents.replace(pattern, `${key}=${value}`)
      : `${contents.trimEnd()}\n${key}=${value}\n`,
    "utf8",
  );
}

async function main() {
  const env = loadEnvLocal();

  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be in\n" +
        ".env.local before this can run. See SETUP-CALENDAR.md.",
    );
    process.exit(1);
  }

  // Guards against a stray request to the callback being treated as the
  // answer to this one.
  const state = randomBytes(16).toString("hex");

  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.searchParams.set("client_id", clientId);
  consent.searchParams.set("redirect_uri", REDIRECT);
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("scope", SCOPE);
  consent.searchParams.set("state", state);
  // Without both of these Google returns an access token and no refresh
  // token, and the whole point of this script is the refresh token.
  consent.searchParams.set("access_type", "offline");
  consent.searchParams.set("prompt", "consent");

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }

      const returned = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      const done = (message: string) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          `<body style="font:16px system-ui;padding:3rem;background:#04070d;color:#dff1fb">
             <p>${message}</p><p style="color:#7fa8c4">You can close this tab.</p>
           </body>`,
        );
        server.close();
      };

      if (error) {
        done(`Google said: ${error}`);
        reject(new Error(error));
        return;
      }

      if (url.searchParams.get("state") !== state) {
        done("That response did not belong to this request.");
        reject(new Error("state mismatch"));
        return;
      }

      if (!returned) {
        done("No code came back.");
        reject(new Error("no code"));
        return;
      }

      done("Calendar connected.");
      resolve(returned);
    });

    server.listen(PORT, () => {
      console.log("\nOpen this in your browser and approve access:\n");
      console.log(consent.toString());
      console.log("\nWaiting for the redirect…");
    });

    /*
     * Long enough to actually finish.
     *
     * Five minutes was not: approving this involves choosing an account,
     * clicking past an unverified-app warning, and often going back to the
     * consent screen to add yourself as a test user. Timing out mid-way means
     * starting over with a fresh URL, because the state token changes.
     */
    setTimeout(() => {
      server.close();
      reject(
        new Error(
          "Timed out after twenty minutes. Run `npm run calendar:connect` " +
            "again for a fresh link — the old one is no longer valid.",
        ),
      );
    }, 20 * 60_000).unref();
  });

  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });

  const data = (await token.json()) as {
    refresh_token?: string;
    error_description?: string;
    error?: string;
  };

  if (!data.refresh_token) {
    console.error(
      `\nNo refresh token came back: ${
        data.error_description ?? data.error ?? "unknown"
      }`,
    );
    // The usual cause, and it is not obvious: Google issues a refresh token
    // only on first consent unless it is asked to prompt again.
    console.error(
      "If you have approved this app before, revoke it at\n" +
        "https://myaccount.google.com/permissions and run this again.",
    );
    process.exit(1);
  }

  saveToEnvLocal("GOOGLE_OAUTH_REFRESH_TOKEN", data.refresh_token);

  console.log("\nRefresh token saved to .env.local.");
  console.log("Restart the dev server, and add it to Vercel to deploy.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
