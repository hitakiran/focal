# Focal

Recap the part of a YouTube video you've already watched. Pause, hit Recap, and Focal pulls key moments from that section and plays them back as a short highlight reel with optional voiceover.

## What's in this repo

- **Next.js backend** — transcript + Claude analyze APIs
- **Chrome extension** (`extension/`) — pause popup, recap playback, key-moment panel
- **Brand docs** — `docs/branding/`

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the test UI. Load the extension from `extension/` in `chrome://extensions` (Developer mode → Load unpacked).

The extension calls `http://localhost:3000` via `background.js` — keep the dev server running while using Focal.

## APIs

- `POST /api/transcript` — `{ videoUrl }` → caption segments
- `POST /api/analyze` — `{ transcript, startTime, endTime }` → key moments + narration

## Status

v1 prototype complete — checkpoint logic, voiceover, branding, and edge cases are in place. Next step: deploy backend (e.g. Vercel) and point the extension at production.
