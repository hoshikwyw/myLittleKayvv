import { readFileSync } from "node:fs";

/**
 * Telegram from a laptop.
 *
 * Webhooks need a public URL, which a development machine does not have. This
 * polls instead and feeds the exact same handler the webhook uses, so what is
 * tested here is what runs in production — only the transport differs.
 *
 *   npm run telegram        listen and reply until stopped
 *   npm run telegram -- id  print the chat id of whoever messages next
 *   npm run telegram -- register https://your-app.vercel.app
 *   npm run telegram -- unregister
 */

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, value] = match;
      if (!process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Fine — the environment may already carry what is needed.
  }
}

loadEnvLocal();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error(
    "TELEGRAM_BOT_TOKEN is not set. Get one from @BotFather and put it in .env.local.",
  );
  process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;

async function api(method: string, body?: unknown) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await response.json()) as {
    ok: boolean;
    result?: unknown;
    description?: string;
  };
}

interface Update {
  update_id: number;
  message?: { text?: string; chat?: { id?: number; first_name?: string } };
}

/** Prints the chat id of the next person to message the bot. */
async function showChatId() {
  console.log("Send your bot any message. Waiting…\n");
  let offset = 0;

  for (;;) {
    const res = await api("getUpdates", { offset, timeout: 30 });
    const updates = (res.result ?? []) as Update[];

    for (const update of updates) {
      offset = update.update_id + 1;
      const chat = update.message?.chat;
      if (!chat?.id) continue;

      console.log(`  Chat id: ${chat.id}${chat.first_name ? `  (${chat.first_name})` : ""}`);
      console.log("\nPut that in .env.local as TELEGRAM_CHAT_ID.");
      return;
    }
  }
}

async function register(baseUrl: string) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not set. Add a long random string to .env.local.");
    process.exit(1);
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const res = await api("setWebhook", {
    url,
    secret_token: secret,
    // Anything else is noise we ignore anyway.
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });

  console.log(res.ok ? `Webhook set to ${url}` : `Failed: ${res.description}`);
}

async function unregister() {
  const res = await api("deleteWebhook", { drop_pending_updates: true });
  console.log(res.ok ? "Webhook removed. Polling can be used again." : `Failed: ${res.description}`);
}

/**
 * Long-poll and reply.
 *
 * A registered webhook and polling are mutually exclusive in Telegram, so this
 * clears the webhook first rather than failing with a confusing error.
 */
async function listen() {
  const { respondTo, isOwner, POLLING_BUDGET_MS } = await import(
    "@/lib/telegram/handle"
  );

  await api("deleteWebhook");

  const me = await api("getMe");
  const username = (me.result as { username?: string } | undefined)?.username;
  console.log(`Listening as @${username ?? "unknown"}. Ctrl-C to stop.\n`);

  let offset = 0;

  for (;;) {
    let updates: Update[] = [];
    try {
      const res = await api("getUpdates", { offset, timeout: 30 });
      updates = (res.result ?? []) as Update[];
    } catch (error) {
      // A dropped connection should not end the session.
      console.error("  poll failed:", error instanceof Error ? error.message : error);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;

      const text = update.message?.text;
      const chatId = update.message?.chat?.id;
      if (!text || chatId === undefined) continue;

      if (!isOwner(String(chatId))) {
        console.log(`  ignored a message from chat ${chatId} (not the owner)`);
        continue;
      }

      console.log(`  → ${text}`);
      const started = Date.now();
      await respondTo({
        chatId: String(chatId),
        text,
        updateId: update.update_id,
        budgetMs: POLLING_BUDGET_MS,
      });
      console.log(`  ← replied in ${Math.round((Date.now() - started) / 100) / 10}s`);
    }
  }
}

const [command, argument] = process.argv.slice(2);

if (command === "id") await showChatId();
else if (command === "register") {
  if (!argument) {
    console.error("Usage: npm run telegram -- register https://your-app.vercel.app");
    process.exit(1);
  }
  await register(argument);
} else if (command === "unregister") await unregister();
else await listen();
