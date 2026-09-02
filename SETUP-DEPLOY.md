# Deploying Kayv, for nothing

Everything below is free, permanent, and needs no credit card. Checked in
September 2026 — free tiers move, so trust the console over this page.

| | Free tier | Card? |
|---|---|---|
| **Vercel Hobby** | 1M function calls, 100GB transfer, 30s functions, **one cron a day** | no |
| **Neon** | 0.5GB, 100 compute-hours/month, sleeps when idle | no |
| **Supabase** (alternative) | 500MB, pgvector included | no |

Vercel Hobby forbids commercial use. A personal assistant is fine.

---

## Read this first

**Reminders do not work until you deploy.** They fire from Vercel Cron against
a hosted database. Running locally, a birthday passes in silence — which is the
one thing [AGENTS.md](AGENTS.md) says must never happen.

**Set `APP_PASSWORD`.** Kayv holds birthdays, relationships and private notes
about the people you love, and a deployment puts that on a public URL. Without
a password anyone who finds the address can read all of it, delete it, talk to
Kayv as you, and spend your API quotas. `/api/health` reports `ok: false` and a
`WARNING` if you deploy without one.

---

## 1. The database

Either works. Kayv picks its driver from the connection string, so nothing in
the code changes.

### Neon (recommended)

Full walkthrough in **[SETUP-NEON.md](SETUP-NEON.md)**. In short:
[neon.com](https://neon.com) → sign up → new project → **Connect** → copy the
string **with pooling on** (it has `-pooler` in the hostname).

Neon sleeps after five minutes idle and wakes itself on the next query, so the
daily cron is enough to keep it useful and it costs nothing while you are not
using it.

### Supabase

[supabase.com](https://supabase.com) → new project → **Connect** → choose the
**Transaction pooler** string (port `6543`), not the direct one. Serverless
functions open and drop connections constantly, and the direct port will run
out of them.

Then enable the extension once, in the SQL editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**One thing to know:** a free Supabase project **pauses after 7 days with no
database activity**, and unpausing is a manual click in their dashboard. The
daily cron keeps it awake — but if you ever pause the Vercel project, the
database follows a week later and reminders stop silently. Neon has no such
behaviour, which is why it is the recommendation for something whose job is to
remember things unattended.

### Either way: run the migrations

Against the hosted database, from your machine:

```bash
DATABASE_URL="<the pooled connection string>" npm run db:migrate:local
```

Check it landed — you want seven tables and `pgvector: true`:

```bash
DATABASE_URL="<same string>" npx tsx scripts/health.ts 2>/dev/null || echo "use /api/health after deploying"
```

---

## 2. Push to GitHub

Vercel deploys from a repository.

```bash
gh repo create MyLittleKayv --private --source=. --push
```

**Private.** `.env.local` is gitignored so no keys are in the history, but the
repository still describes exactly what this is and who it belongs to.

---

## 3. Deploy

1. Go to **[vercel.com](https://vercel.com)** and sign in with GitHub. No card.
2. **Add New → Project**, pick `MyLittleKayv`, and **do not click Deploy yet.**
3. Expand **Environment Variables** and add everything below.
4. Now deploy.

Deploying first and adding variables after means one failed build and a confusing
error; it costs nothing but a minute of thinking something is broken.

### Required

| Variable | Where it comes from |
|---|---|
| `APP_PASSWORD` | You choose it. Long, and not one you use elsewhere. |
| `DATABASE_URL` | The pooled string from step 1. |
| `GEMINI_API_KEY` | Your existing key. Required even if you chat on Groq — embeddings never leave Gemini. |
| `CRON_SECRET` | Copy from `.env.local`, or make a new one. |
| `TIMEZONE` | `Asia/Yangon` |
| `HOME_LOCATION` | `16.8409,96.1735` |

### Worth having

| Variable | What it buys |
|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Reminders reaching your phone. Without a channel, the cron runs and tells nobody. |
| `TELEGRAM_WEBHOOK_SECRET` | Required for the webhook. Any long random string. |
| `GROQ_API_KEY` | The fallback models. |
| `TAVILY_API_KEY` | Current news and prices. |
| `ASSISTANT_NAME`, `OWNER_NAME` | What it calls itself, and you. |

Copy the values from `.env.local` — Vercel has no way to read that file, and
nothing is carried over from your machine.

---

## 4. Point Telegram at the deployment

Your bot is currently talking to your laptop through long-polling. Now it can
have a real webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-app>.vercel.app/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

`{"ok":true,"result":true}` means it took. Message your bot to confirm.

---

## 5. Check it, properly

**Is it locked?** Open the deployment. You should land on a password screen.
If the workspace appears instead, `APP_PASSWORD` did not get set — fix that
before anything else.

**Is it healthy?**

```bash
curl -s https://<your-app>.vercel.app/api/health \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Look for `ok: true`, `locked: true`, `migrated: true`, `pgvector: true`,
`remindersReady: true`, and no `WARNING`.

**Do reminders actually fire?** This is the one worth doing by hand, because it
is the feature the whole project exists for. Ask Kayv to remember a birthday
for tomorrow, then:

```bash
curl -s "https://<your-app>.vercel.app/api/cron/reminders?dryRun=1" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

`dryRun` shows what it *would* send. Drop it to send for real and watch
Telegram. Vercel's own daily run happens at 00:00 UTC — 06:30 in Yangon.

---

## Living inside the free tiers

**Vercel's one-cron-a-day** is why reminders arrive as a morning digest rather
than at the moment a plan is due. A free external pinger against
`/api/cron/reminders` would allow hourly; the sweep is idempotent, so extra runs
are harmless.

**Caches do not survive.** Weather, streets and place lookups are cached in
process memory, and serverless functions are created and destroyed constantly.
Expect the first street fetch in a while to take its full ten seconds or so
rather than the instant one you get locally.

**Neon sleeping** adds about half a second to the first query after a quiet
spell. Nothing to fix; worth recognising so it does not look like a bug.

---

## If something goes wrong

**Every page redirects to `/login` and the password is right.** The cookie is
`Secure`, so it needs HTTPS. Vercel is HTTPS everywhere, so this points at a
custom domain served over plain HTTP.

**`No model is configured`.** No provider key reached Vercel. Adding a variable
requires a **redeploy** to take effect — it is not picked up live.

**Telegram is silent.** Check the webhook took:
`curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`. A
`last_error_message` there names the actual problem.

**A turn ends with "that took longer than I have".** The function hit its 30
seconds. Usually a slow free-tier model — switch models in the System panel.

**`/api/health` says `ok: false` with a `WARNING`.** `APP_PASSWORD` is unset
and the deployment is public. Set it and redeploy, then change any password you
had used, on the assumption it was seen.
