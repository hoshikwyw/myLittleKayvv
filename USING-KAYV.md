# Using Kayv

You talk to it. There are no forms — everything below is said in ordinary
sentences, typed in the Conversation panel, spoken to the reactor, or sent to
the Telegram bot. All three go to the same place.

**The one thing to watch:** under your message a small line appears — `✓
remember_person`, `✓ find_places`. That is Kayv actually doing something. If
you ask it to remember a birthday and no line appears, nothing was saved.

---

## People

Just say it. Nothing needs to exist first.

> Nandar is my partner. She works as a nurse and hates coriander.

That stores Nandar, her relationship to you, and two facts about her. Each one
comes back as a card you can undo — a wrong guess costs one click, and a fact
never captured is lost entirely, which is why it saves first and asks later.

Add more whenever it comes up:

> Nandar's mother is called Daw Khin. They speak every Sunday.

Ask about them the same way:

> Who is Nandar? · What do I know about her family? · Who do I know?

**Never invent a fact about a person yourself.** If you tell Kayv something
uncertain, say so — it stores what you say, and "I think" is part of what you
said.

---

## Dates that come back every year

Birthdays, anniversaries, memorials. **These are the ones that get reminders.**

> Nandar's birthday is 14 March. · Our anniversary is 2 November 2019.

The year is optional — give it and Kayv can say "she turns 30 this year".

By default you are reminded **7 days before, 1 day before, and on the day**.
Ask for something else:

> Remind me two weeks before my mother's birthday.

These live in Kayv's own memory, not your calendar, and fire whether or not
you ever open the app.

---

## Plans and tasks

Anything with a date, or repeating:

> Dentist on Thursday at 3pm. · Call Mum every Sunday. · Pay rent on the 1st.

Say "tomorrow" or "Friday" and Kayv works out the actual date rather than
guessing. Repeats can be daily, weekly, monthly or yearly.

> What's on today? · What's coming up this week? · Mark the dentist done.

---

## Notes

Anything worth keeping that is not a person or a date:

> Remember that the good coffee place on Pyay Road closes at 4. · My passport
> expires next August.

Ask for it back by meaning, not by wording — "what did I say about coffee?"
finds it even if you wrote "café".

---

## Your calendar — read only

**Kayv cannot create, move or delete calendar events.** The permission it was
given is read-only, deliberately: it reads what is on your calendar and has no
business writing to it. Ask it to add something and it will tell you it cannot.

To *create* an event, use Google Calendar. Kayv will see it.

What it can do:

> What's on my calendar this week? · Am I free on Thursday afternoon?

It reads your **primary** calendar. Events on a secondary calendar are
invisible to it.

**Plans versus calendar.** A plan lives in Kayv's memory and can remind you. A
calendar event lives in Google and cannot. Use plans for things you want
chased; use the calendar for things you keep there anyway.

---

## Reminders reaching you

Every morning Kayv sends one Telegram message with what is coming — birthdays
inside their warning window, plans due, anniversaries.

Vercel's free tier allows one scheduled run a day, so it is a **morning digest
rather than an alarm at the moment something is due**. A plan at 21:00 is
mentioned that morning, not at nine in the evening. That is a deliberate
choice: a reminder arriving at the wrong time is worse than one arriving as a
digest.

The daily run happens at **06:30 Yangon time**.

---

## Asking it things

> What's the weather in Tokyo? · Where's the nearest pharmacy? · Show me
> Reykjavik on the map. · What's the latest news in Myanmar?

Looking a place up marks it on the world map, which zooms to street level for
somewhere nearby. Ask "what's it like here?" after clicking the map and it
answers about that point.

From Telegram, ask for a location and it arrives as a **tappable pin** you can
open for directions.

---

## Where to say it

**The web app** — everything, plus the map and the memory panel where you can
edit or delete anything stored.

**Your voice** — click the reactor and talk. Reaching for the microphone while
it is answering interrupts it, which is how a conversation works.

**Telegram** — the same assistant, same memory. Useful when you are out.

---

## Two habits worth having

**Correct it out loud.** "No, her birthday is the 14th, not the 4th." It
updates rather than storing both.

**Check the tool line.** It is the difference between Kayv doing something and
Kayv saying something. Especially for anything you are relying on later.
