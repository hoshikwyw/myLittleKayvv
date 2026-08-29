# Deploying Kayv

Everything below runs on free tiers. Total cost: nothing.

The repo already contains what Vercel needs — `vercel.json` for the cron
schedule, security headers in `next.config.ts`, and a readiness probe at
`/api/health`.

---

## 1. Database (required)

Reminders and memory do not exist without this.

1. Create a project at [neon.com](https://neon.com) — free, no card.
   Step-by-step: **[SETUP-NEON.md](SETUP-NEON.md)**.
2. Copy the **pooled** connection string. It looks like:
   `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
3. Put it in `.env.local` as `DATABASE_URL`.
4. Run the migration:

   ```bash
   npm run db:migrate
   ```

   This creates the `vector` extension and seven tables.

5. Confirm it landed:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:5173/api/health
   ```

   Look for `"migrated": true` and `"pgvector": true`.

**Use the pooled string, not the direct one.** Serverless functions open a
connection per invocation; the direct endpoint runs out of connections under
even light use.

---

## 2. Telegram (required for reminders)

1. Message [@BotFather](https://t.me/botfather), send `/newbot`, follow the
   prompts. He gives you a token like `8123456789:AAF...`.
2. Send your new bot any message — a bot cannot start a conversation with you,
   so this step is not optional.
3. Get your chat id:

   ```bash
   curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
   ```

   Read `result[0].message.chat.id` out of the response.

4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

### Prove it works before deploying

Add a birthday dated tomorrow through the assistant, then:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:5173/api/cron/reminders?dryRun=1"
```

`dryRun=1` shows exactly what would be sent, without sending it or marking
anything as notified. Drop the flag and the message arrives on your phone.

---

## 3. Optional integrations

Each one is skipped cleanly if absent — the tool is not offered and the
assistant is told it cannot do that thing, rather than pretending it can.

| Feature | Variables | Where |
|---|---|---|
| Maps | `GOOGLE_MAPS_API_KEY`, `HOME_LOCATION` | Cloud Console → enable **Places API (New)** |
| Web search | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` | [Programmable Search](https://programmablesearchengine.google.com) |
| Calendar | `GOOGLE_OAUTH_CLIENT_ID`, `_SECRET`, `_REFRESH_TOKEN` | Cloud Console → OAuth client, scope `calendar.readonly` |
| Email fallback | `RESEND_API_KEY`, `REMINDER_EMAIL_TO` | [resend.com](https://resend.com) |

`HOME_LOCATION` is `lat,lng` — what "near me" resolves to. Yangon is
`16.8409,96.1735`.

**Restrict the Maps key** to the Places API in the Cloud Console. An
unrestricted key found in a repo gets used by someone else, on your bill.

---

## 4. Deploy

The GitHub route, not the CLI — it gives automatic deploys on push and is the
supported path for cron jobs.

1. Push the repo to GitHub.
2. At [vercel.com/new](https://vercel.com/new), import the repository. Leave
   every build setting alone; Next.js is detected.
3. Before the first deploy, add the environment variables. **Every one you have
   in `.env.local` must be added here** — Vercel does not read that file.

   Generate a fresh `CRON_SECRET` for production rather than reusing the local
   one:

   ```bash
   openssl rand -hex 32
   ```

4. Deploy.

---

## 5. Verify the deployment

```bash
# Liveness, no auth needed
curl https://<your-app>.vercel.app/api/health

# Full report
curl -H "Authorization: Bearer <PROD_CRON_SECRET>" \
  https://<your-app>.vercel.app/api/health

# What the sweep would send, without sending it
curl -H "Authorization: Bearer <PROD_CRON_SECRET>" \
  "https://<your-app>.vercel.app/api/cron/reminders?dryRun=1"
```

Then open the app, say something worth remembering, and check the undo card
appears.

### Confirming cron is live

Vercel dashboard → your project → **Settings → Cron Jobs**. One entry should be
listed against `/api/cron/reminders`, daily.

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically, using the
environment variable of that name. If `CRON_SECRET` is missing in production the
endpoint returns 401 and reminders silently never fire — so check the first run
in **Deployments → Logs** rather than assuming.

---

## Known limits

| Limit | Consequence |
|---|---|
| Hobby cron runs once a day, UTC only | Sweep is fixed at 00:00 UTC — 06:30 in Yangon |
| Cron timing guaranteed to the hour, not the minute | Handled: the sweep is idempotent per day |
| Functions killed at 30s | Agent loop stops at 25s and says so |
| Gemini free tier trains on inputs | Consider paid or Vertex once real personal data accumulates |
| Free-tier quotas can be cut without notice | `LLMProvider` exists so the model can be swapped in one file |

## If something breaks

| Symptom | Cause |
|---|---|
| `"migrated": false` | Migration never ran against this database |
| Reminders never arrive | `CRON_SECRET` missing in production, or you never messaged the bot |
| Telegram 400 | Wrong `TELEGRAM_CHAT_ID` |
| Microphone does nothing | Firefox has no speech recognition; use Chrome or Edge |
| "memory offline" badge | `DATABASE_URL` not set in Vercel |
