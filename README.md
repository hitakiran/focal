# Focal

Recap the part of a YouTube video you've already watched. Pause, hit Recap, and Focal pulls key moments from that section and plays them back as a short highlight reel with optional voiceover.

## What's in this repo

- **Next.js backend** — transcript + Claude analyze APIs
- **Chrome extension** (`extension/`) — pause popup, recap playback, key-moment panel
- **Brand docs** — `docs/branding/`

---

## Setup (for anyone cloning this repo)

**Prerequisites:** [Node.js](https://nodejs.org) (includes npm), Google Chrome, and a free [Anthropic](https://console.anthropic.com) account for an API key.

You run everything **locally** with **your own** Anthropic API key. Do not use someone else's deployed backend — that would use their API key and bill their account.

### 1. Clone the repo

```bash
git clone https://github.com/hitakiran/focal.git
cd focal
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add your Anthropic API key

Create a file named `.env.local` in the project root (same folder as `package.json`):

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get a key at [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key**.

Never commit `.env.local` — it is already in `.gitignore`.

### 4. Start the backend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the API test UI.

### 5. Load the Chrome extension

The extension is **not on the Chrome Web Store** — after cloning, load it unpacked from the `extension/` folder (steps below).

1. Open Chrome → `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder in this repo

The extension is configured for **localhost** by default (`extension/background.js` → `http://localhost:3000`).

### 6. Try it

1. Keep `npm run dev` running
2. Open a YouTube video with captions
3. Pause the video → Focal popup appears (or click the extension icon)
4. Click **Recap**

---

## APIs

- `POST /api/transcript` — `{ videoUrl }` → caption segments
- `POST /api/analyze` — `{ transcript, startTime, endTime }` → key moments + narration

---

## Optional: deploy your own backend (Vercel)

If you want the extension to work **without** running `npm run dev`:

1. Deploy this repo to [Vercel](https://vercel.com)
2. Add `ANTHROPIC_API_KEY` in Vercel → **Settings → Environment Variables**
3. Update `extension/background.js`:

   ```javascript
   const API_BASE_URL = "https://your-app.vercel.app";
   ```

4. Update `extension/manifest.json` → `host_permissions`:

   ```json
   "host_permissions": [
     "http://localhost:3000/*",
     "https://your-app.vercel.app/*"
   ]
   ```

5. Reload the extension in `chrome://extensions`

Only point at a backend **you** control — not a public URL belonging to someone else.

---

## Status

v1 prototype complete — checkpoint logic, voiceover, branding, and edge cases are in place.
