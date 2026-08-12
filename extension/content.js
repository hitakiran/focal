// This file is a "content script."
// Chrome injects it into YouTube watch pages (see manifest.json).
//
// Phase 0: When the user pauses, show a "Recap" button in the top-right corner.
// Phase 1 (next): Clicking the button will start the video highlight recap.

console.log("Video Recap extension loaded (Phase 0: Recap button)");

const RECAP_BUTTON_ID = "video-recap-button";
const OVERLAY_ID = "video-recap-overlay";

let listenersAttached = false;

// Remember where the user paused so we can use it in later phases.
let lastPauseInfo = {
  videoUrl: "",
  pausedAt: 0,
};

function ensureStyles() {
  if (document.getElementById("video-recap-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "video-recap-styles";
  style.textContent = `
    #video-recap-button {
      position: fixed !important;
      top: 80px !important;
      right: 20px !important;
      z-index: 2147483647 !important;
      padding: 10px 16px !important;
      border: none !important;
      border-radius: 999px !important;
      background: #ff0000 !important;
      color: #ffffff !important;
      font-family: Arial, sans-serif !important;
      font-size: 14px !important;
      font-weight: bold !important;
      cursor: pointer !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25) !important;
    }

    #video-recap-button:hover {
      background: #cc0000 !important;
    }
  `;

  document.documentElement.appendChild(style);
}

function hideRecapButton() {
  const button = document.getElementById(RECAP_BUTTON_ID);
  if (button) {
    button.remove();
  }
}

function showRecapButton() {
  ensureStyles();
  hideRecapButton();

  const button = document.createElement("button");
  button.id = RECAP_BUTTON_ID;
  button.type = "button";
  button.textContent = "Recap";

  button.addEventListener("click", () => {
    console.log("Video Recap: Recap button clicked");
    console.log("Video Recap: paused at", lastPauseInfo.pausedAt, "seconds");
    console.log("Video Recap: video URL", lastPauseInfo.videoUrl);
    // Phase 1 will start the highlight recap here.
  });

  document.documentElement.appendChild(button);
  console.log("Video Recap: Recap button shown (top right)");
}

function attachVideoListeners(video) {
  video.addEventListener("pause", () => {
    lastPauseInfo = {
      videoUrl: window.location.href,
      pausedAt: video.currentTime,
    };

    console.log("Video paused at:", lastPauseInfo.pausedAt, "seconds");
    showRecapButton();
  });

  video.addEventListener("play", () => {
    console.log("Video resumed at:", video.currentTime, "seconds");
    hideRecapButton();
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
