# Taskboard — free task manager with Telegram input

React + Tailwind SPA → Firebase Firestore (real-time `onSnapshot`) ← Make.com ← Telegram bot.
Everything runs on free tiers: Firebase Spark, Vercel/Netlify Hobby, Make Free, Telegram.

```
Telegram message ──► Make.com (HTTP module) ──► Firestore REST API ──► onSnapshot ──► your screen
```

## Project files

| File | Purpose |
|---|---|
| `src/App.jsx` | Entire UI: master list, weekly planner, month calendar, add/complete/delete, live listener |
| `src/firebase.js` | **Firebase init — paste your config here (or in `.env`)** |
| `firestore.rules` | Security rules (validate task shape) |
| `.env.example` | Template for the 6 Firebase variables |
| `package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.jsx`, `src/index.css` | Build setup (Vite + Tailwind 3) |

## Firestore schema — collection `tasks`

| Field | Type | Notes |
|---|---|---|
| `title` | string | Required, 1–500 chars |
| `status` | string | `"pending"` or `"completed"` |
| `createdAt` | timestamp | Set by the app (`serverTimestamp`) or by Make (RFC 3339) |
| `dueDate` | string \| null | Real date as `"YYYY-MM-DD"` (e.g. `"2026-11-23"`), or `null` = Inbox (no date) |
| `source` | string | `"web"` or `"telegram"` (shows a badge) |
| `completedAt` | timestamp \| null | Set when completed |

Telegram tasks arrive with `dueDate: null`, so they wait in the **Inbox**. Tap **Today** or **Tomorrow** on a card, or pick any date, to schedule them. Three views read the same data: **Master list** (Overdue, Inbox, Scheduled, Done), **Weekly planner** (real dates with previous/next week buttons), and **Month** (calendar; tap a day to see and add its tasks).

---

## Part 1 — Run locally

1. Install Node.js 18+ from nodejs.org.
2. In this folder: `npm install`
3. Copy `.env.example` to `.env` (after Part 2).
4. `npm run dev` and open the printed URL.

## Part 2 — Firebase setup (free Spark plan, no credit card)

1. Go to https://console.firebase.google.com → **Add project** → name it → disable Google Analytics → **Create**.
2. **Build → Firestore Database → Create database** → choose a location near you → **Start in production mode** → **Enable**.
3. **Rules** tab → paste the contents of `firestore.rules` → **Publish**.
4. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (no Hosting needed) → copy the `firebaseConfig` values.
5. Put the values in `.env`:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
   (Or paste literal strings directly into `src/firebase.js`.)
6. Note your **Project ID** and **Web API key**; Make.com needs both.

## Part 3 — Deploy free

### Vercel
1. Push this folder to a GitHub repo (`.env` is git-ignored, which is correct).
2. https://vercel.com → **Add New → Project** → import the repo. Framework preset: **Vite** (auto-detected).
3. Open **Environment Variables** and add the 6 `VITE_FIREBASE_*` values.
4. **Deploy**. You get a free `https://your-app.vercel.app` URL (no domain purchase).

### Netlify (alternative)
Import the repo → build command `npm run build` → publish directory `dist` → add the same 6 environment variables → Deploy.

Changing an env var later requires a redeploy, because Vite bakes values in at build time.

---

## Part 4 — Create the Telegram bot

1. In Telegram, search for **@BotFather** (verified badge) and open it.
2. Send `/newbot`.
3. Enter a display name (e.g. `My Taskboard`), then a username ending in `bot` (e.g. `my_taskboard_123_bot`).
4. BotFather replies with an **HTTP API token** (`123456789:AAH...`). Keep it private.
5. Open your new bot and press **Start**, then send any message, e.g. `hello`. This gives Make something to detect later.
6. **Find your chat ID** (used to block strangers). Do this *before* turning on the Make scenario. Open this in a browser, with your token inserted:
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   Find `"chat":{"id":123456789,...}` and note the number. If the result is empty, send the bot another message and reload. (Once Make's trigger is active, `getUpdates` stops working. You can also read the chat ID from Make's first run output.)

## Part 5 — Make.com scenario

Create a free account at https://www.make.com.

### Module 1: Telegram Bot → Watch Updates
1. **Create a new scenario** → click the big **+** → search **Telegram Bot** → choose **Watch Updates**.
2. **Create a connection** → paste the BotFather token → Save.
3. Click **OK**. This is an *instant* trigger: it runs the moment a message arrives, so the free plan’s 15-minute polling limit doesn’t apply.
4. Click **Run once**, send your bot a message, and confirm a bundle appears. The text is at `message.text` and your chat ID at `message.chat.id`.

### Filter (important: only you can add tasks)
Click the small wrench icon between modules → **Set up a filter**:
- Label: `Owner text only`
- Condition 1: `message → chat → id` — **Numeric operators: Equal to** — your chat ID
- Condition 2 (AND): `message → text` — **Basic operators: Exists**
- Condition 3 (AND): `message → text` — **Text operators: Not equal to** — `/start`

### Module 2: HTTP → Make a request
Add a module after the filter: **HTTP → Make a request**, then fill in:

| Setting | Value |
|---|---|
| URL | `https://firestore.googleapis.com/v1/projects/YOUR_PROJECT_ID/databases/(default)/documents/tasks?key=YOUR_WEB_API_KEY` |
| Method | `POST` |
| Headers | none needed (the content type is set below) |
| Body type | `Raw` |
| Content type | `JSON (application/json)` |
| Parse response | Yes |

**Request content** (type this in, then use Make's mapping panel to insert the formulas; Make shows them as pills):

```json
{
  "fields": {
    "title":     { "stringValue": "{{replace(replace(1.message.text; "\\"; "\\\\"); "\""; "\\\"")}}" },
    "status":    { "stringValue": "pending" },
    "dueDate":   { "nullValue": null },
    "source":    { "stringValue": "telegram" },
    "createdAt": { "timestampValue": "{{formatDate(now; "YYYY-MM-DDTHH:mm:ss"; "UTC")}}Z" }
  }
}
```

What this does:
- `1.message.text` is the Telegram message, mapped into `title`. The two `replace()` calls escape backslashes and quotes so a message like `Call "Sam"` doesn’t break the JSON.
- `createdAt` is the current time in UTC, in the format Firestore expects.
- If Make complains about the formula syntax, keep the JSON shape but use the mapping panel to build each expression. If you get a `400 INVALID_ARGUMENT` on messages with quotes, add Make’s **JSON → Create JSON** module before the HTTP step and send its output instead. Keep Telegram messages single-line.

### Module 3 (optional): confirmation reply
Add **Telegram Bot → Send a Text Message or a Reply**: Chat ID `1.message.chat.id`, Text `✅ Added: {{1.message.text}}`.

### Turn it on
1. Click **Run once**, send `Buy milk` to the bot, and watch the modules run. The task should appear in your web app immediately.
2. Toggle **Scheduling → ON** (bottom left) and save the scenario.

Free-tier note: Make’s free plan has a small monthly operations quota (about 1,000 at the time of writing, so check current limits). Each Telegram message uses roughly 2–3 operations with the optional reply.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Red banner “Firestore denied access” | Publish `firestore.rules` in the Firebase console. |
| Make HTTP returns `403` | Same: rules not published, or wrong project ID in the URL. |
| Make HTTP returns `400` | The JSON is invalid: check quotes in the body, or use **Create JSON**. |
| Make returns `404` / `NOT_FOUND` | Firestore database wasn’t created, or the project ID is wrong. |
| Task shows in Firestore but not in the app | Check field types: `title`/`status` strings; `createdAt` a timestamp. |
| App says “Firebase isn’t configured yet” | Missing `VITE_FIREBASE_*` variables; on Vercel, add them and redeploy. |
| Telegram trigger sees nothing | Remove any webhook you set elsewhere; make sure the scenario is ON or in “Run once”. |

## Security: read this

This app has no login, so the rules allow anyone who knows your project ID and API key to read or write `tasks`. The rules do enforce the task shape and size, and the Make filter blocks other Telegram users, but **don’t store anything sensitive here**. Your Firebase config is visible in the shipped JS (that is normal for Firebase). To lock it down later:

1. Enable **Authentication → Email/Password**, create one user for yourself and one “bot” user.
2. Add a login screen to the app and change the rules to `request.auth != null`.
3. In Make, call `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=API_KEY` first, then send the returned `idToken` as `Authorization: Bearer ...` on the Firestore request.

Also set a **budget alert** in Google Cloud if you ever upgrade the plan. On Spark, usage simply stops at the free quota; it never bills.
