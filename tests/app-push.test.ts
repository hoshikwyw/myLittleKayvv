import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FcmClient,
  buildMessage,
  isGoneToken,
  parseServiceAccount,
  signAssertion,
  type SendResult,
} from "@/lib/notify/fcm";
import { AppPushChannel, type DeviceStore } from "@/lib/notify/app";
import { deliver } from "@/lib/notify";
import type { DeliveryResult, NotificationChannel } from "@/lib/notify/types";

/** A real RSA key, made for the test, in the shape Firebase hands out. */
async function makeKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey))
    .toString("base64")
    .replace(/(.{64})/g, "$1\n");
  return {
    publicKey: pair.publicKey,
    pem: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`,
  };
}

function keyJson(pem: string) {
  return JSON.stringify({
    type: "service_account",
    project_id: "kayv-test",
    client_email: "sender@kayv-test.iam.gserviceaccount.com",
    private_key: pem,
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

test("the service account is read as JSON or as base64 of it", async () => {
  const { pem } = await makeKey();
  const json = keyJson(pem);

  const direct = parseServiceAccount(json);
  const encoded = parseServiceAccount(Buffer.from(json).toString("base64"));

  assert.equal(direct.projectId, "kayv-test");
  assert.deepEqual(encoded, direct);
});

test("a key pasted through a single-line field gets its newlines back", async () => {
  const { pem } = await makeKey();
  const flattened = keyJson(pem).replace(/\\n/g, "\\\\n");

  assert.equal(parseServiceAccount(flattened).privateKey, pem);
});

test("a wrong key says what is wrong instead of failing later", () => {
  assert.throws(() => parseServiceAccount("{not json"), /not valid JSON/);
  assert.throws(
    () => parseServiceAccount(JSON.stringify({ project_id: "x" })),
    /missing project_id, client_email or private_key/,
  );
});

test("the assertion is a JWT Google can verify, valid for an hour", async () => {
  const { pem, publicKey } = await makeKey();
  const account = parseServiceAccount(keyJson(pem));

  const jwt = await signAssertion(account, 1_000_000);
  const [header, claims, signature] = jwt.split(".");

  const decoded = JSON.parse(Buffer.from(claims, "base64url").toString("utf8"));
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString("utf8")), {
    alg: "RS256",
    typ: "JWT",
  });
  assert.equal(decoded.iss, account.clientEmail);
  assert.equal(decoded.aud, "https://oauth2.googleapis.com/token");
  assert.equal(decoded.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(decoded.exp - decoded.iat, 3600);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  assert.equal(valid, true);
});

test("the message is a high-priority notification on the reminders channel", () => {
  const { message } = buildMessage("tok", "Starting soon: Study", "• 19:30 Study");

  assert.equal(message.token, "tok");
  assert.deepEqual(message.notification, {
    title: "Starting soon: Study",
    body: "• 19:30 Study",
  });
  assert.equal(message.android.priority, "HIGH");
  assert.equal(message.android.notification.channel_id, "reminders");
});

test("only an unregistered token counts as gone, not a passing error", () => {
  assert.equal(isGoneToken(404, null), true);
  assert.equal(
    isGoneToken(400, { error: { details: [{ errorCode: "UNREGISTERED" }] } }),
    true,
  );
  assert.equal(isGoneToken(500, { error: { message: "internal" } }), false);
  assert.equal(isGoneToken(429, null), false);
});

test("one access token serves every push until it nearly expires", async () => {
  const { pem } = await makeKey();
  const account = parseServiceAccount(keyJson(pem));
  const calls: string[] = [];
  let now = 0;

  const fakeFetch = (async (url: string | URL | Request) => {
    const target = String(url);
    calls.push(target.includes("oauth2") ? "token" : "send");
    if (target.includes("oauth2")) {
      return Response.json({ access_token: `at-${calls.length}`, expires_in: 3600 });
    }
    return Response.json({ name: "projects/kayv-test/messages/1" });
  }) as typeof fetch;

  const client = new FcmClient(account, fakeFetch, () => now);

  assert.deepEqual(await client.send("a", "t", "b"), { ok: true });
  assert.deepEqual(await client.send("b", "t", "b"), { ok: true });
  assert.deepEqual(calls, ["token", "send", "send"]);

  now = 3_550_000; // inside the last minute
  await client.send("c", "t", "b");
  assert.deepEqual(calls, ["token", "send", "send", "token", "send"]);
});

test("a refused service account is reported, not thrown", async () => {
  const { pem } = await makeKey();
  const client = new FcmClient(
    parseServiceAccount(keyJson(pem)),
    (async () =>
      Response.json({ error: "invalid_grant", error_description: "Invalid JWT" }, {
        status: 400,
      })) as typeof fetch,
  );

  const result = await client.send("a", "t", "b");
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /Invalid JWT/);
});

function fakeStore(initial: string[]): DeviceStore & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    tokens: async () => initial,
    remove: async (tokens) => {
      removed.push(...tokens);
    },
  };
}

function channelWith(store: DeviceStore, results: Record<string, SendResult>) {
  process.env.FIREBASE_SERVICE_ACCOUNT = "set";
  return new AppPushChannel(store, () => ({
    send: async (token) => results[token],
  }));
}

test("with no phone registered, the app channel says how to fix it", async () => {
  const result = await channelWith(fakeStore([]), {}).send("s", "b");

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Open the Android app/);
});

test("delivered if any phone took it, and dead phones are forgotten", async () => {
  const store = fakeStore(["live", "dead", "flaky"]);
  const result = await channelWith(store, {
    live: { ok: true },
    dead: { ok: false, error: "Requested entity was not found.", gone: true },
    flaky: { ok: false, error: "Internal error", gone: false },
  }).send("s", "b");

  assert.deepEqual(result, { channel: "app", ok: true });
  assert.deepEqual(store.removed, ["dead"]);
});

test("when every phone is gone, the error says to open the app again", async () => {
  const store = fakeStore(["dead"]);
  const result = await channelWith(store, {
    dead: { ok: false, error: "Requested entity was not found.", gone: true },
  }).send("s", "b");

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /re-register/);
});

function fake(
  name: "telegram" | "app" | "email",
  ok: boolean,
  configured = true,
): NotificationChannel & { sent: number } {
  return {
    name,
    sent: 0,
    isConfigured: () => configured,
    async send() {
      this.sent++;
      return { channel: name, ok, error: ok ? undefined : `${name} failed` };
    },
  };
}

test("a reminder goes to Telegram and the app both", async () => {
  const telegram = fake("telegram", true);
  const app = fake("app", true);
  const email = fake("email", true);
  const recorded: DeliveryResult[] = [];

  const outcome = await deliver([telegram, app], [email], "s", "b", async (r) => {
    recorded.push(r);
  });

  assert.equal(outcome.delivered, true);
  assert.equal(telegram.sent, 1);
  assert.equal(app.sent, 1);
  assert.equal(email.sent, 0, "email is a fallback, not a third copy");
  assert.deepEqual(recorded.map((r) => r.channel), ["telegram", "app"]);
});

test("one primary failing still counts as delivered, without email", async () => {
  const email = fake("email", true);
  const outcome = await deliver(
    [fake("telegram", false), fake("app", true)],
    [email],
    "s",
    "b",
    async () => {},
  );

  assert.equal(outcome.delivered, true);
  assert.equal(email.sent, 0);
});

test("email steps in only when no primary channel delivered", async () => {
  const email = fake("email", true);
  const outcome = await deliver(
    [fake("telegram", false), fake("app", false)],
    [email],
    "s",
    "b",
    async () => {},
  );

  assert.equal(outcome.delivered, true);
  assert.equal(email.sent, 1);
  assert.deepEqual(outcome.attempts.map((a) => a.channel), ["telegram", "app", "email"]);
});

test("an unconfigured channel is skipped, not counted as a failure", async () => {
  const app = fake("app", true, false);
  const outcome = await deliver([fake("telegram", true), app], [], "s", "b", async () => {});

  assert.equal(app.sent, 0);
  assert.deepEqual(outcome.attempts.map((a) => a.channel), ["telegram"]);
});
