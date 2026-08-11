// This file is a "content script."
// Chrome injects it into YouTube watch pages (see manifest.json).
//
// Why a content script?
// - It runs in the context of the web page (youtube.com).
// - It can read info from the page (video time, URL).
// - It can also add HTML to the page (our recap popup).
//
// Important: this file does NOT call localhost directly.
// Chrome blocks that from youtube.com for security.
// Instead, we send a message to background.js, which makes the API calls.

console.log("Video Recap extension loaded (with popup UI)");

// ID we use to find/remove our popup on the page.
const OVERLAY_ID = "video-recap-overlay";

// Track whether we've already attached listeners, so we only do it once.
let listenersAttached = false;

// Turn seconds (like 31) into mm:ss (like "0:31")
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// Escape text so it is safe to show inside HTML.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Inject CSS once. YouTube has high z-index layers, so we use !important.
function ensureOverlayStyles() {
  if (document.getElementById("video-recap-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "video-recap-styles";
  style.textContent = `
    #video-recap-overlay {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      background: rgba(0, 0, 0, 0.6) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 16px !important;
      box-sizing: border-box !important;
    }

    #video-recap-panel {
      position: relative !important;
      width: 100% !important;
      max-width: 420px !important;
      max-height: 80vh !important;
      overflow-y: auto !important;
      background: #ffffff !important;
      color: #111111 !important;
      border-radius: 12px !important;
      padding: 20px !important;
      font-family: Arial, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.5 !important;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35) !important;
    }

    #video-recap-close {
      position: absolute !important;
      top: 8px !important;
      right: 10px !important;
      border: none !important;
      background: transparent !important;
      font-size: 24px !important;
      cursor: pointer !important;
      color: #666666 !important;
    }
  `;

  document.documentElement.appendChild(style);
}

// Remove any existing popup before showing a new one.
function removeOverlay() {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
  }
}

// Add the popup to the page (on <html>, not just <body>, so YouTube can't hide it easily).
function showOverlay(panelHtml) {
  ensureOverlayStyles();
  removeOverlay();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div id="video-recap-panel">
      <button id="video-recap-close" type="button">&times;</button>
      ${panelHtml}
    </div>
  `;

  // Click the dark background to close.
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      removeOverlay();
    }
  });

  overlay.querySelector("#video-recap-close").addEventListener("click", removeOverlay);

  document.documentElement.appendChild(overlay);
  console.log("Video Recap: popup shown on page");
}

function showLoadingOverlay() {
  showOverlay(`
    <h2 style="margin: 0 0 8px 0; font-size: 20px;">Video Recap</h2>
    <p style="margin: 0; color: #555555;">Generating your recap...</p>
  `);
}

function showRecapOverlay({ keyMoments, narration, endTime }) {
  const momentsHtml = (keyMoments || [])
    .map((moment) => {
      return `
        <li style="margin-bottom: 10px;">
          <strong>${formatTime(moment.timestamp)} — ${escapeHtml(moment.title)}</strong><br />
          <span style="color: #444444;">${escapeHtml(moment.description)}</span>
        </li>
      `;
    })
    .join("");

  showOverlay(`
    <h2 style="margin: 0 0 4px 0; font-size: 20px;">Video Recap</h2>
    <p style="margin: 0 0 12px 0; color: #555555;">
      What you watched (0:00 to ${formatTime(endTime)})
    </p>
    <h3 style="margin: 0 0 8px 0; font-size: 16px;">Narration</h3>
    <p style="margin: 0 0 16px 0;">${escapeHtml(narration)}</p>
    <h3 style="margin: 0 0 8px 0; font-size: 16px;">Key moments</h3>
    <ul style="margin: 0; padding-left: 18px;">
      ${momentsHtml}
    </ul>
  `);
}

function showErrorOverlay(message) {
  showOverlay(`
    <h2 style="margin: 0 0 8px 0; font-size: 20px;">Video Recap</h2>
    <p style="margin: 0; color: #b00020;">${escapeHtml(message)}</p>
  `);
}

function requestRecap(videoUrl, endTime) {
  console.log("Video Recap: asking background script to fetch recap...");
  showLoadingOverlay();

  chrome.runtime.sendMessage(
    {
      type: "FETCH_RECAP",
      videoUrl: videoUrl,
      endTime: endTime,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("Video Recap: message error:", chrome.runtime.lastError.message);
        showErrorOverlay("Could not talk to the extension background script.");
        return;
      }

      if (response.error) {
        console.error("Video Recap: backend error:", response.error);
        showErrorOverlay(response.error);
        return;
      }

      console.log(
        "Video Recap: transcript received,",
        response.transcriptCount,
        "segments"
      );
      console.log("Video Recap: key moments:", response.keyMoments);
      console.log("Video Recap: narration:", response.narration);

      try {
        showRecapOverlay({
          keyMoments: response.keyMoments,
          narration: response.narration,
          endTime: endTime,
        });
      } catch (error) {
        console.error("Video Recap: popup error:", error);
        showErrorOverlay("Could not display recap on the page.");
      }
    }
  );
}

function attachVideoListeners(video) {
  video.addEventListener("pause", () => {
    const pausedAt = video.currentTime;
    const videoUrl = window.location.href;

    console.log("Video paused at:", pausedAt, "seconds");
    console.log("Video URL:", videoUrl);

    requestRecap(videoUrl, pausedAt);
  });

  video.addEventListener("play", () => {
    console.log("Video resumed at:", video.currentTime, "seconds");
  });

  console.log("Video Recap: listening for play and pause events");
}

function trySetupVideo() {
  const video = document.querySelector("video");

  if (video) {
    console.log("Video Recap: video element found:", video);
  } else {
    console.log("Video Recap: No video element found");
    return false;
  }

  if (!listenersAttached) {
    attachVideoListeners(video);
    listenersAttached = true;
  }

  return true;
}

if (!trySetupVideo()) {
  console.log("Video Recap: will retry every 500ms until video element appears...");

  const waitForVideo = setInterval(() => {
    const found = trySetupVideo();

    if (found) {
      console.log("Video Recap: video found on retry, stopping checks");
      clearInterval(waitForVideo);
    }
  }, 500);
}
