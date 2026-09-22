/**
 * Firebase Cloud Messaging, over its HTTP v1 API.
 *
 * No Firebase SDK. The admin SDK is large, pulls in gRPC, and exists to do two
 * things this needs: sign a short-lived token with the service account's key,
 * and post a message. Web Crypto signs RS256 on its own, and the message is
 * one `fetch`, so the whole integration is this file.
 *
 * Kept free of the database and of `env`, so it can be tested with a key made
 * up on the spot and a fake `fetch`.
 */

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/**
 * Reads the service-account key, given as its JSON or as that JSON in base64.
 *
 * Throws with a message that says what is wrong, because the alternative is a
 * reminder that silently never reaches the phone.
 */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim();
  let json: string = text;

  if (!text.startsWith("{")) {
    try {
      json = Buffer.from(text, "base64").toString("utf8");
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is neither JSON nor base64.");
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
  }

  const projectId = parsed.project_id;
  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;

  if (
    typeof projectId !== "string" ||
    typeof clientEmail !== "string" ||
    typeof privateKey !== "string" ||
    !privateKey.includes("PRIVATE KEY")
  ) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key. " +
        "Use the key from Firebase → Project settings → Service accounts.",
    );
  }

  return {
    projectId,
    clientEmail,
    // A key pasted through a single-line field arrives with literal "\n".
    privateKey: privateKey.replace(/\\n/g, "\n"),
    tokenUri:
      typeof parsed.token_uri === "string" ? parsed.token_uri : DEFAULT_TOKEN_URI,
  };
}

function base64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  return crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(body, "base64"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * The signed assertion Google exchanges for an access token.
 *
 * An hour is the longest Google accepts, and the token it buys lasts as long,
 * so one signature covers every push in a sweep and the next hour's besides.
 */
export async function signAssertion(
  account: ServiceAccount,
  nowSeconds: number,
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SCOPE,
      aud: account.tokenUri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );

  const unsigned = `${header}.${claims}`;
  const key = await importPrivateKey(account.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64url(signature)}`;
}

/**
 * The message Firebase is asked to deliver.
 *
 * `notification` rather than data-only, so Android draws it itself when the app
 * is closed — which is when a reminder matters. High priority so a phone in
 * Doze shows it on time instead of at its next maintenance window.
 */
export function buildMessage(token: string, title: string, body: string) {
  return {
    message: {
      token,
      notification: { title, body },
      android: {
        priority: "HIGH",
        notification: {
          // Created by the app on first start; see use-app-notifications.ts.
          channel_id: "reminders",
        },
      },
    },
  };
}

export type SendResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** Firebase says this phone will never receive anything at this token. */
      gone: boolean;
    };

/** Whether a failed send means the token is dead, not that Firebase hiccupped. */
export function isGoneToken(status: number, payload: unknown): boolean {
  if (status === 404) return true;

  const details = (payload as { error?: { details?: unknown[] } } | null)?.error
    ?.details;
  if (!Array.isArray(details)) return false;

  return details.some(
    (d) => (d as { errorCode?: string }).errorCode === "UNREGISTERED",
  );
}

type Fetch = typeof fetch;

export class FcmClient {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** A Google access token, reused until a minute before it expires. */
  async accessToken(): Promise<string> {
    const now = this.now();
    if (this.cached && this.cached.expiresAt - 60_000 > now) {
      return this.cached.token;
    }

    const assertion = await signAssertion(this.account, Math.floor(now / 1000));
    const response = await this.fetchImpl(this.account.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    const data = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    } | null;

    if (!response.ok || !data?.access_token) {
      throw new Error(
        `Google refused the service account: ${data?.error_description ?? data?.error ?? response.status}`,
      );
    }

    this.cached = {
      token: data.access_token,
      expiresAt: now + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  }

  async send(token: string, title: string, body: string): Promise<SendResult> {
    try {
      const accessToken = await this.accessToken();
      const response = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${this.account.projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildMessage(token, title, body)),
        },
      );

      if (response.ok) return { ok: true };

      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      return {
        ok: false,
        error: payload?.error?.message ?? `Firebase returned ${response.status}`,
        gone: isGoneToken(response.status, payload),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        gone: false,
      };
    }
  }
}
