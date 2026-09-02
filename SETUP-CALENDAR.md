# Connecting your Google Calendar

Free, no credit card. This is the fiddliest setup in the project — not because
it costs anything, but because Google's console has more steps than the others
put together. About fifteen minutes, once.

Kayv reads your calendar. It never writes to it: the scope requested is
**read-only**, so the token this produces cannot move a meeting or delete
anything even if it leaked.

---

## 1. A Google Cloud project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and
   sign in with the account whose calendar you want to read.
2. Click the project dropdown at the top → **New Project**.
3. Name it `kayv` → **Create**. Wait for it to switch to the new project — the
   rest of this happens *inside* it, and doing step 2 in the wrong project is
   the most common way to lose twenty minutes here.

**No billing account is needed.** The Calendar API is free and has no paid
tier to accidentally enter.

---

## 2. Turn the Calendar API on

1. **APIs & Services → Library**.
2. Search **Google Calendar API** → click it → **Enable**.

---

## 3. The consent screen

Google will not issue a token without one, even for an app only you will use.

1. **APIs & Services → OAuth consent screen**.
2. Choose **External**. (Internal only exists for Workspace organisations.)
3. Fill in the three required fields — app name `Kayv`, your email twice — and
   **Save and Continue** through the rest. Scopes can be left empty; the script
   asks for what it needs at the time.
4. On the **Test users** step, click **Add users** and add your own email
   address. **This one matters.** An External app in testing will refuse
   anybody not on that list, and the failure appears much later as a confusing
   "access blocked" screen.
5. Leave the app in **Testing**. Publishing invites a verification review you
   have no use for.

**A consequence of staying in Testing:** the refresh token expires after seven
days. When Kayv says it cannot reach your calendar, run `npm run
calendar:connect` again. Publishing the app removes that limit and costs
nothing, but Google may ask for a privacy policy URL for an app nobody else
will ever use.

---

## 4. Credentials

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Kayv`.
4. Under **Authorised redirect URIs**, click **Add URI** and enter exactly:

   ```
   http://localhost:5174/callback
   ```

   Exactly that — Google matches it character for character, and a trailing
   slash is a different URI.
5. **Create**. Copy the **Client ID** and **Client secret**.

Put both in `.env.local`:

```bash
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
```

---

## 5. Get the token

```bash
npm run calendar:connect
```

It prints a URL. Open it, approve access, and the page says *"Calendar
connected."* The refresh token is written into `.env.local` for you.

You will see **"Google hasn't verified this app"** — that is the Testing status
from step 3, and the app in question is yours. Click **Advanced → Go to Kayv
(unsafe)**.

Then restart the dev server.

---

## 6. Check it

The **System status** panel should show **calendar — ONLINE**. Ask Kayv
*"what's on my calendar this week?"* and watch for the `read_calendar` tool
line under your message. If that line never appears, the answer came from the
model's imagination rather than your calendar.

---

## Deploying

Add all three to Vercel and redeploy:

```
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
```

The redirect URI stays `http://localhost:5174/callback` — it is only used when
*obtaining* a token, which always happens on your machine. Vercel only ever
refreshes one, which needs no redirect at all.

---

## If something goes wrong

**"Access blocked: Kayv has not completed the Google verification process."**
Your email is not in **Test users** (step 3.4).

**"redirect_uri_mismatch".** The URI in step 4.4 does not match exactly. Check
for a missing port, `https` instead of `http`, or a trailing slash.

**"No refresh token came back."** Google issues one only on first consent.
Revoke the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions)
and run the command again.

**It worked and then stopped after a week.** The Testing-status expiry. Run
`npm run calendar:connect` again, or publish the app.

**The row says ONLINE but Kayv sees no events.** It reads your *primary*
calendar. Events living on a secondary calendar are not visible to it.
