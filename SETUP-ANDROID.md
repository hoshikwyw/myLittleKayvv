# Kayv on your Android phone

The app is a thin native shell around your Vercel deployment. It adds what a
browser tab cannot: its own icon, full screen, the phone's speech recogniser
and voice, and a back button that closes things instead of leaving.

Because it loads the live site, **every push to Vercel reaches the phone
without reinstalling**. You only build a new APK when something in `android/`,
`capacitor.config.ts` or a native plugin changes.

| | |
|---|---|
| Works on | Android 7.0 and newer |
| Needs | Internet (the offline screen appears without it) |
| Permissions | Internet, and the microphone — asked the first time you tap the orb |
| Size | about 4 MB |

---

## 1. Put the APK on Google Drive

The file is `release/Kayv-1.0.0.apk` in this project.

1. On the computer, open [drive.google.com](https://drive.google.com).
2. **New → Folder**, name it `Kayv`, open it.
3. Drag `release\Kayv-1.0.0.apk` into the window. Wait for "Upload complete".

Keep it **private** — don't turn on link sharing. You sign in to Drive on the
phone with the same account, so no link is needed, and the APK carries your
deployment's address.

---

## 2. Install it on the phone

1. Open the **Drive** app → `Kayv` folder → tap **Kayv-1.0.0.apk**.
2. Tap **Download** (the ⋮ menu if there is no button), then open it from the
   notification or from **Files → Downloads**.
   Opening it straight from Drive also works on most phones.
3. Android says installing from this source isn't allowed:
   **Settings → Allow from this source** → back → **Install**.
4. **Google Play Protect** may warn that it doesn't recognise the app. That is
   because it was not installed from the Play Store, not because anything was
   found. Tap **More details → Install anyway**. If it offers to send the app
   for scanning, either answer is fine.
5. **Open**.

Afterwards you can switch "Allow from this source" off again for Drive or
Files: **Settings → Apps → Special app access → Install unknown apps**.

---

## 3. First run

1. Sign in with your `APP_PASSWORD`. It lasts 30 days, as in a browser.
2. Tap the orb and allow the **microphone** when asked.
3. Say something short — "what's the weather at home". The words appear once
   you stop talking, not while you speak; that is deliberate
   (the reason is in `src/lib/voice/native.ts`).

**Check these while you are there:**

- Nothing sits under the clock/camera at the top, or the gesture bar at the
  bottom.
- Tap the message box: the keyboard should push the box up, not cover it.
- Make a panel full screen, then press **back** — it should shrink, not close
  the app. Back with nothing open sends Kayv to the background.
- Turn on airplane mode and reopen: the offline screen, with **Try again**.

If the keyboard does cover the message box, say so — the fix is the
`@capacitor/keyboard` plugin and a rebuild.

---

## 4. Reminders as phone notifications

Every reminder goes to **Telegram and the app** at once; email is tried only
if neither delivers. The app's notification comes through Firebase Cloud
Messaging, free on Firebase's Spark plan with no card.

### One-time setup

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Create a project** (Analytics off).
2. **Add app → Android**, package name exactly `com.mylittlekayv.app` →
   download **google-services.json** → put it at `android/app/google-services.json`.
   It is not a secret and is committed; it tells the app which project it
   belongs to.
3. **Project settings → Service accounts → Generate new private key.** This
   one *is* secret — it can send notifications as the project. Keep it out of
   the project folder (`*firebase-adminsdk*.json` is gitignored regardless).
4. Turn it into one line and set it as `FIREBASE_SERVICE_ACCOUNT`, in
   `.env.local` and in Vercel (Production), then redeploy:

   ```
   node -e "process.stdout.write(Buffer.from(require('fs').readFileSync('key.json')).toString('base64'))"
   ```

5. `npm run db:migrate:url` once, for the `devices` table.
6. Build and install the APK (section 6). Open it, allow notifications.

### Checking it

**System status → "this phone"** says how registration went on the phone, in
words, with the fix. **"app notifications"** above it only says the server has
the Firebase key.

| "This phone" says | Do this |
|---|---|
| Registered | Nothing. Reminders arrive here. |
| Notifications are blocked | Settings → Apps → Kayv → Notifications → Allow, then return to Kayv |
| Could not reach Google's notification service (SERVICE_NOT_AVAILABLE) | The network is blocking Google, or Play services is held back. Try with a VPN on; set Google Play services' battery use to **No restrictions**; update it from the Play Store. Kayv retries on its own and each time you return to it. |
| Google Play services is missing… | Update or enable Google Play services |
| The server refused the phone | Sign in again; the session had expired |

On the Redmi Note 14 (HyperOS 3) the first registration needed a VPN: without
one the network could not reach Firebase. Registration is only needed once per
install; the token is reused after that.

**Xiaomi / HyperOS:** also set Kayv to **Autostart on** and **Battery saver →
No restrictions** (Settings → Apps → Kayv). Otherwise HyperOS may hold back
notifications while the app is closed.

While Kayv is open on screen Android does not pop up its own notifications;
they appear when it is closed or in the background, which is when a reminder
matters. Telegram arrives either way.

A phone whose token Firebase reports as gone (app uninstalled, data cleared)
is removed from the list automatically. Signing out removes this phone too.

---

## 5. If voice does not work

Kayv uses the phone's own speech services, not Chrome's.

| Symptom | Fix |
|---|---|
| "no speech recognition service" | Install or update the **Google** app, and check **Settings → Apps → Default apps → Digital assistant / Voice input** points at Google. |
| "Microphone access was blocked" | **Settings → Apps → Kayv → Permissions → Microphone → Allow**. |
| Listens but never speaks | **Settings → search "Text-to-speech"** → engine **Speech Services by Google**, and install English voice data. Check media volume too. |
| Speech is cut off when you tap the orb | Intended: talking over Kayv stops it. |

Burmese is read on screen but never spoken, as on the web.

---

## 6. Releasing a new version

Only needed for native changes (see the top of this page).

1. In `android/app/build.gradle`, raise **`versionCode`** by one and update
   `versionName`. Android refuses to install over an app with the same or a
   higher code.
2. `npm run mobile:apk`
3. Upload the new `release/Kayv-<version>.apk` to the same Drive folder and
   install it over the old one. Your sign-in survives.

It needs the JDK (`JAVA_HOME`), the Android SDK (`ANDROID_HOME`) and the
signing key below. The first build downloads Gradle's dependencies and takes
around ten minutes; later ones are quicker.

`npm run mobile:assets` redraws the icon and splash screen if you change them
in `scripts/android-assets.mjs`.

---

## 7. The signing key — back it up

Two files, both gitignored:

- `android/keystore/kayv-release.jks` — the key
- `android/keystore.properties` — its passwords

**Every future APK must be signed with this exact key.** Lose it and a new
version cannot be installed over the old one: you would have to uninstall
first, which signs you out and forgets the app's permissions.

Copy both files somewhere private that is **not** the Drive folder holding the
APK — a password manager's file attachment is ideal. To restore on a new
computer, put them back at those two paths.

`npm run mobile:apk` stops with a message if `keystore.properties` is missing,
rather than producing an unsigned APK no phone will accept.

---

## If something goes wrong

| Problem | Cause |
|---|---|
| "App not installed" | An older build signed with a different key is installed. Uninstall it, then install. Or the `versionCode` was not raised. |
| "There was a problem parsing the package" | The download was incomplete. Download again. |
| Offline screen with signal | Vercel is down, or `mobile/www/app-url.json` points at the wrong address (it is baked into the APK — change it and rebuild). |
| An outside link opens in the browser | Intended. Only the Kayv site opens inside the app; anything else goes to your browser, where you can get back. |
| Old behaviour after a push | Vercel is still deploying. Close Kayv from recent apps and reopen. |
