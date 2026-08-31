# Setting up the fallback models

Kayv runs on Gemini by default. The free tier is generous but finite, and when
it runs out every turn comes back with *"I've used up today's free allowance
from the model."*

The fix is a second vendor. Each provider has its own separate quota, so adding
a key genuinely multiplies how much you can do in a day. **Adding more keys
from the *same* provider does not** — Groq's limits are per-organisation and
Gemini's are per-project.

None of these need a credit card. You do not need all four; **Groq alone is
enough**, and takes about two minutes.

---

## Before you start: what a turn actually costs

Worth knowing, because it changes which provider is worth having.

A single question to Kayv costs roughly **7,000 tokens**. About 2,900 of that
is fixed overhead — the system prompt plus thirteen tool schemas — and it is
re-sent on *every* call, of which a tool-using turn makes two or more.

So the limit you hit first is **tokens per day, not requests per day**. Groq
advertises 14,400 requests a day, which sounds enormous and is beside the
point: you will hit its 200,000-token ceiling at about 28 turns.

| Provider | Free limit | Turns/day here | Card? | Trains on your data? |
|---|---|---|---|---|
| **Gemini** (already set up) | ~250 req/day | ~125 | no | no |
| **Groq** | 200K tokens/day | ~28–38 | no | no |
| **Cerebras** | 1M tokens/day | — see below | **yes, in practice** | no |
| **OpenRouter** | 50 req/day unfunded | ~25 | no | **yes, required** |
| **Mistral** | ~1B tokens/month | plenty | no | **yes, unless you opt out** |

Numbers change often — check each console for what your account actually has.

**Do not trust a model name from documentation.** Every model in this project's
catalog was read off the vendor's own `/models` endpoint and then sent a real
request. Two that the docs describe at length — Llama 3.3 70B on Groq, Qwen 32B
on Cerebras — do not exist on a new account at all, and sat in the list
answering *"model does not exist"* until they were actually called.

---

## 1. Groq — start here

The one to get. Instant, no card, every model supports tool calling, and it is
very fast.

1. Go to **[console.groq.com](https://console.groq.com)** and sign up. Email,
   Google or GitHub all work.
2. Verify your email if it asks.
3. Click **API Keys** in the left sidebar.
4. Click **Create API Key**, name it `kayv`, and confirm.
5. **Copy it now.** It is shown once and cannot be recovered — if you lose it,
   delete the key and make another.

Paste it into `.env.local`:

```bash
GROQ_API_KEY=gsk_...
```

That unlocks three models in the picker. All three were tested against the
real API with this project's actual thirteen tool schemas:

| Model | Answered in | Prompt cost | Notes |
|---|---|---|---|
| **GPT-OSS 120B** | ~2.3s | 2,587 tokens | The one to use. |
| **GPT-OSS 20B** | ~1.4s | 2,587 tokens | Quickest, but see below. |
| **Qwen 3.8 27B** | ~1.1s | 3,568 tokens | Strong, dearer prompt. |

The prompt cost column is why GPT-OSS is listed first. Same prompt, same tools,
but its tokenizer encodes them in 27% fewer tokens — and against a fixed 200K
daily ceiling that is roughly 38 turns a day instead of 28.

**GPT-OSS 20B follows instructions less carefully.** Asked for one sentence it
answered correctly and then appended a markdown `*Details:*` block, which the
system prompt explicitly asks against because replies here get read aloud. Fast
and fine for a quick question; the 120B is the better default.

---

## 2. Cerebras — biggest budget, but it wants billing

Advertised as 1M tokens a day with no card. In practice a fresh key answers:

```
Payment required to access this resource. Visit your billing tab.
```

That was true for every model on the account, so the free tier is not something
you simply get on signup. If you want to try:

1. Go to **[cloud.cerebras.ai](https://cloud.cerebras.ai)** and sign up.
2. Click **API Keys** in the left sidebar.
3. Click **Generate API Key**, name it `kayv`. Copy it immediately — it is
   shown once.
4. Check the **Billing** tab. Until something there is activated, every request
   is refused.

```bash
CEREBRAS_API_KEY=csk-...
```

**Adding the key anyway is harmless.** Kayv treats "payment required" like any
other provider failure and moves to the next model in the chain, saying so in
the panel. The model appears in the picker; choosing it explicitly just falls
straight through to whatever can answer.

**The other caveat**, if you do enable it: free-tier context stops at 8,192
tokens. A single call here is about 3,200, so short exchanges are fine — but a
few turns of history and tool results will be rejected mid-conversation. That
is why Cerebras sits *below* Groq in the fallback order despite the bigger
budget: fallback fires part-way through a conversation, exactly when the
history is already long.

---

## 3. OpenRouter — read this one before signing up

One key, many models, with automatic failover between them. But its free
endpoints come with a condition.

**You must switch on training and logging for free models to work at all.**
Without it you get `No endpoints found matching your data policy`. That is not
a setting you can turn off and keep using the free tier.

Kayv stores facts about your family, your partner, birthdays and anniversaries.
Those go into the prompt when they are relevant. I would not put that traffic
through an endpoint that requires training to be enabled — but it is your call,
and it is last in the fallback order either way, so it only ever answers when
everything else is exhausted.

If you want it:

1. Go to **[openrouter.ai](https://openrouter.ai)** and sign up.
2. Go to **[openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy)**
   and enable the free-endpoint options — *"Enable free endpoints that may
   train on inputs"* and *"...that may publish prompts"*.
3. Go to **[openrouter.ai/keys](https://openrouter.ai/keys)** and click
   **Create Key**. Name it `kayv`. **Leave the credit limit blank.**
4. Copy the key.

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Ignore any prompt pushing you toward buying credits — free models do not need
them. An unfunded account gets 50 free requests a day, which is about 25 turns
here.

Kayv uses the model id **`openrouter/free`**, which picks only from models that
cost nothing. Do not change this to `openrouter/auto` — that routes to the
*best* model including paid ones, and bills you for them.

---

## 4. Mistral — largest quota, same objection

About a billion tokens a month, which is effectively unlimited for one person.

**The free "Experiment" tier trains on your data by default.** Unlike
OpenRouter you *can* turn this off and keep using it, but you have to do it
yourself, and their own documentation contradicts itself on the point — one
page says free-tier inputs may be used for training, another says API data is
never used. When a vendor's own docs disagree, treat the more permissive
reading as the one you are agreeing to.

If you want it, **turn the setting off first, before the key exists**:

1. Go to **[console.mistral.ai](https://console.mistral.ai)** and sign up.
2. Go to **Admin Console → Privacy** and turn **off** *"Allow Mistral to use
   your data for model improvement."*
3. Only then go to **API Keys** and click **Create new key**. Name it `kayv`.
4. Copy it.

```bash
MISTRAL_API_KEY=...
```

---

## 5. Restart and check

`.env.local` is read at startup, so the dev server has to be restarted:

```bash
npm run dev
```

Then open **[localhost:5173](http://localhost:5173)** and look at the **System
status** panel. Under **MODEL** you should see the new models listed as
selectable rather than greyed out under *"add a key to unlock"*.

Pick one to force it, or leave **Automatic** — which uses the best available
and moves down the list on its own as each runs out.

After a turn, the top-right of that panel says which model actually answered.
If it fell back, it says so in amber.

### Checking a key works without spending a turn

```bash
curl -N -X POST http://localhost:5173/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hi in three words"}],"model":"groq/qwen-3.6-27b"}'
```

The first line back names the model that took it:

```
data: {"type":"model","id":"groq/qwen-3.6-27b","label":"Qwen 3.6 27B","fellBack":false}
```

If it says `gemini/flash` instead, the Groq key is not being seen — check for a
typo, and that you restarted the server.

---

## Deploying

Vercel does not read `.env.local`. Every key you add here has to be added again
in **Project → Settings → Environment Variables**, then redeployed.

---

## What does *not* fall back

**Embeddings stay on Gemini permanently**, whichever chat model is selected.

This is not a limitation, it is a correctness requirement: every memory already
stored was embedded by Gemini at 768 dimensions, and vectors from two different
models are not comparable. Embedding one new fact with Groq would not fail — it
would write successfully, become unfindable by search, and quietly degrade
recall with nothing in the logs to show for it.

So `GEMINI_API_KEY` stays required even if you never use Gemini for chat. The
**gemini (memory)** row in the System panel tracks exactly this: when it is
offline, Kayv cannot save or recall anything, even while another provider is
answering perfectly happily.

---

## If something goes wrong

**A model stays greyed out.** The server did not see the key. Check the
variable name matches exactly, that there are no quotes or spaces around the
value, and that you restarted `npm run dev`.

**`No endpoints found matching your data policy`.** OpenRouter, and the privacy
settings in step 3 are not enabled.

**A long conversation suddenly fails on Cerebras.** The 8K context cap. Start a
new conversation, or pick a different model.

**Everything says "used up today's free allowance".** Every configured provider
is exhausted. Gemini's resets at midnight US Pacific, which is about 14:30 in
Yangon.

**A key leaked into git.** `.env.local` is gitignored, so this should not
happen — but if it does, revoke the key in that provider's console immediately
and create a new one. Revoking is instant and free.
