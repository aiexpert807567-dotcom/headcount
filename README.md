# Hourly Headcount → Excel

Turns ground-team WhatsApp reports (text or screenshot) into clean TSV rows
you can paste straight into the master Excel sheet — one row per hour,
built up across as many messages as you paste in before copying once.

## How it works

1. **Text messages** (any of the formats you've been getting — dash, colon,
   bullet) are parsed **entirely offline**, with strict regex against the
   35-column master schema in `schema.js`. No API calls, no cost, no
   internet dependency for this path.

2. **Images** go through OCR (Tesseract.js, in-browser) automatically, then
   — if you've deployed the Worker — the raw OCR text is automatically
   sent to Cloudflare Workers AI to be reformatted into clean lines before
   parsing. No button to press; it just happens. The Worker is told never
   to invent or guess numbers, only to reformat what's actually there, and
   to leave `?` for anything unreadable so it still gets flagged instead
   of silently being wrong. If the Worker isn't deployed/configured yet,
   it falls back to using the raw OCR text directly.

3. **Multiple messages accumulate.** Every time you hit "Parse & Add
   row(s)", the new rows are merged into a running table instead of
   replacing it — paste message after message, then hit "Copy all for
   Excel" once at the end.

4. **Merging vs duplicates vs conflicts**, all automatic:
   - Same hour, a location not seen yet for that hour → merged in (this is
     the normal case — different sector messages covering the same hour
     but different locations).
   - Same hour, same location, same number → treated as a duplicate
     (e.g. someone resent the same message) and silently skipped.
   - Same hour, same location, but a *different* number → flagged as a
     conflict instead of guessed — the first value is kept and shown in
     the warning banner so you can go verify which is correct.

5. **Unknown locations** (e.g. something like "SS-06" that isn't in the
   master list) pause parsing and ask you, once, what it should map to
   (existing column or brand-new one). Your answer is saved in the
   browser's `localStorage`, so next time it's seen it's applied silently.

6. **Total mismatches** (the message says "Total: 28" but the individual
   numbers you parsed add up to 25) are flagged on screen.

7. Click **Copy all for Excel** — full-width, tab-separated block (Hour +
   all 35 columns + Total) on your clipboard, so pasting into the master
   sheet lines up correctly.

---

## Deploying via GitHub Codespaces

### 1. Push these files to a GitHub repo
```bash
git init
git add .
git commit -m "Headcount app"
gh repo create headcount-app --public --source=. --push
# (or create the repo on github.com first, then: git remote add origin <url> && git push -u origin main)
```

### 2. Open it in a Codespace
On the repo's GitHub page: **Code → Codespaces → Create codespace on main**.
This gives you a full VS Code + terminal in the browser, already cloned.

### 3. Get a Cloudflare account + enable Workers AI
- Sign up / log in at https://dash.cloudflare.com
- Workers AI is on the free tier by default (with daily neuron limits) —
  nothing extra to enable, it's available to any account.

### 4. Install & authenticate Wrangler (inside the Codespace terminal)
```bash
npm install -g wrangler
wrangler login
```
This prints a URL — Codespaces will prompt you to open it in a browser tab
to approve access. Once approved, come back to the terminal.

*(Alternative if the browser popup doesn't work well in Codespaces: create
an API token instead — Cloudflare dashboard → your profile icon → **My
Profile → API Tokens → Create Token** → use the "Edit Cloudflare Workers"
template → copy the token, then in the Codespace run
`export CLOUDFLARE_API_TOKEN=<paste-token>` before deploying. You'll also
need your Account ID, shown on the right side of the Cloudflare dashboard
overview page — `export CLOUDFLARE_ACCOUNT_ID=<paste-id>`.)*

### 5. Add the Workers AI binding
Create `wrangler.toml` in the repo root:
```toml
name = "headcount-cleaner"
main = "worker.js"
compatibility_date = "2026-01-01"

[ai]
binding = "AI"
```

### 6. Deploy the Worker
```bash
wrangler deploy
```
This prints your live URL, something like
`https://headcount-cleaner.<your-subdomain>.workers.dev`.

### 7. Wire the frontend to the Worker
Open `index.html` in the Codespace, find:
```js
const WORKER_URL = "";
```
Paste your Worker URL in there, then commit and push:
```bash
git add index.html wrangler.toml
git commit -m "Connect worker"
git push
```

### 8. Host the frontend
Easiest options, both free:
- **GitHub Pages**: repo **Settings → Pages → Deploy from a branch → main
  → / (root)**. You'll get a `https://<you>.github.io/headcount-app/` URL.
- **Cloudflare Pages**: `wrangler pages deploy .` from the same folder —
  keeps everything on Cloudflare alongside the Worker.

That's it — open the hosted URL on your phone or laptop and start pasting
messages in.

---

## Teaching it new locations / aliases

You don't need to touch code for this — the first time it sees an unknown
name it'll ask you via a popup, and remembers your answer from then on
(stored per-browser in `localStorage`). If you ever need to reset that
memory (e.g. switching browsers), it's under key `headcount_aliases_v1`.

## Notes / things worth knowing

- The master column order in `schema.js` matches your original Excel
  layout exactly — don't reorder it, or pasted columns will land in the
  wrong place.
- If you ever add a genuinely new physical location permanently (not just
  an alias), add it to `CANONICAL_LOCATIONS` in `schema.js` directly so
  it's there for everyone, not just remembered in one browser.
- The OCR step (Tesseract) runs entirely in the browser. The cleaned-up
  text is the only thing sent to your Worker — never the image itself.
- Accumulated rows live in memory only (cleared on page refresh) — copy
  them out before closing the tab. If you want them to survive a refresh
  too, that's a small change to persist `accumulatedRows` to
  `localStorage` the same way aliases already are — say the word if you
  want that added.

