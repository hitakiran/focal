// This file is a "content script."
// It runs on YouTube watch pages and handles video playback + recap logic.
// A recap popup appears on the page when you pause; popup.html still works from the toolbar.

console.log("Video Recap extension loaded");

const RECAP_PANEL_ID = "video-recap-panel";
const PAUSE_POPUP_ID = "video-recap-pause-popup";

const MIN_CLIP_SECONDS = 3;
const MAX_CLIP_SECONDS = 12;

let listenersAttached = false;
let videoElement = null;
let isRecapPlaying = false;
let isSegmentPlaying = false;
let suppressPausePopup = false;
let voiceoverEnabled = false;

let lastPauseInfo = {
  videoUrl: "",
  pausedAt: 0,
};

// Saved after a recap finishes so the user can browse key moments with arrows.
let lastRecapData = null;

function getRecapBudget(pauseAt) {
  const target = pauseAt * 0.25;
  return Math.min(60, Math.max(20, target));
}

function buildClipDurations(moments, pauseAt) {
  const rawDurations = moments.map((moment) => getClipDuration(moment, pauseAt));
  const budget = getRecapBudget(pauseAt);
  const total = rawDurations.reduce((sum, duration) => sum + duration, 0);

  if (total <= budget) {
    return rawDurations;
  }

  const scale = budget / total;
  return rawDurations.map((duration) =>
    Math.max(MIN_CLIP_SECONDS, duration * scale)
  );
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getClipDuration(moment, pauseAt) {
  const start = moment.timestamp;
  let end = moment.endTime;

  if (typeof end !== "number" || end <= start) {
    end = Math.min(start + MIN_CLIP_SECONDS, pauseAt);
  }

  end = Math.min(end, pauseAt);

  let duration = end - start;
  duration = Math.max(duration, MIN_CLIP_SECONDS);
  duration = Math.min(duration, MAX_CLIP_SECONDS);

  return duration;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function splitNarrationForClips(narration, clipCount) {
  const parts = Array.from({ length: clipCount }, () => "");
  const sentences =
    narration.match(/[^.!?]+[.!?]*\s*/g)?.map((sentence) => sentence.trim()) || [];

  if (sentences.length === 0) {
    parts[0] = narration;
    return parts;
  }

  sentences.forEach((sentence, index) => {
    const partIndex = index % clipCount;
    parts[partIndex] = parts[partIndex]
      ? `${parts[partIndex]} ${sentence}`
      : sentence;
  });

  return parts;
}

function speakForClip(text, clipDurationSeconds) {
  return new Promise((resolve) => {
    if (!text?.trim() || !window.speechSynthesis) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text.trim());
    const wordCount = text.trim().split(/\s+/).length;
    const naturalDurationSeconds = wordCount / 2;
    let rate = naturalDurationSeconds / clipDurationSeconds;
    rate = Math.max(0.55, Math.min(rate, 0.9));

    utterance.rate = rate;
    utterance.onend = resolve;
    utterance.onerror = resolve;

    window.speechSynthesis.speak(utterance);
  });
}

function stopVoiceover() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function muteVideoForVoiceover(video) {
  const wasMuted = video.muted;
  video.muted = true;
  return wasMuted;
}

function restoreVideoAudio(video, wasMuted) {
  video.muted = wasMuted;
}

function ensurePanelStyles() {
  if (document.getElementById("video-recap-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "video-recap-styles";
  style.textContent = `
    #video-recap-panel {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      left: auto !important;
      transform: none !important;
      z-index: 2147483647 !important;
      width: min(360px, calc(100vw - 48px)) !important;
      background: rgba(0, 0, 0, 0.85) !important;
      color: #ffffff !important;
      border-radius: 12px !important;
      padding: 16px !important;
      font-family: Arial, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.5 !important;
    }

    #video-recap-panel h3 {
      margin: 0 0 8px 0 !important;
      font-size: 15px !important;
    }

    #video-recap-panel p {
      margin: 0 0 12px 0 !important;
      color: #eeeeee !important;
    }

    .video-recap-nav {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 12px !important;
      margin-top: 4px !important;
    }

    .video-recap-nav button {
      width: 36px !important;
      height: 36px !important;
      border: 1px solid rgba(255, 255, 255, 0.3) !important;
      border-radius: 8px !important;
      background: rgba(255, 255, 255, 0.12) !important;
      color: #ffffff !important;
      font-size: 18px !important;
      cursor: pointer !important;
    }

    .video-recap-nav button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.22) !important;
    }

    .video-recap-nav button:disabled {
      opacity: 0.35 !important;
      cursor: not-allowed !important;
    }

    .video-recap-nav span {
      font-size: 13px !important;
      color: #dddddd !important;
      white-space: nowrap !important;
    }

    .video-recap-play-segment {
      width: 100% !important;
      margin-top: 12px !important;
      padding: 10px 14px !important;
      border: none !important;
      border-radius: 8px !important;
      background: #2563eb !important;
      color: #ffffff !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
    }

    .video-recap-play-segment:hover:not(:disabled) {
      background: #1d4ed8 !important;
    }

    .video-recap-play-segment:disabled {
      opacity: 0.55 !important;
      cursor: not-allowed !important;
    }

    #video-recap-pause-popup {
      position: fixed !important;
      top: 80px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      width: 280px !important;
      background: #ffffff !important;
      color: #374151 !important;
      border-radius: 12px !important;
      padding: 16px !important;
      font-family: Arial, sans-serif !important;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18) !important;
    }

    #video-recap-pause-popup .popup-title {
      margin: 0 24px 8px 0 !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      color: #6b7280 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.04em !important;
    }

    #video-recap-pause-popup .status-text {
      margin: 0 0 12px 0 !important;
      font-size: 13px !important;
      line-height: 1.4 !important;
    }

    #video-recap-pause-popup .recap-action-button {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
      width: 100% !important;
      padding: 12px 16px !important;
      border: none !important;
      border-radius: 8px !important;
      background: #2563eb !important;
      color: #ffffff !important;
      font-size: 15px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35) !important;
    }

    #video-recap-pause-popup .recap-action-button:hover:not(:disabled) {
      background: #1d4ed8 !important;
    }

    #video-recap-pause-popup .recap-action-button:disabled {
      opacity: 0.55 !important;
      cursor: not-allowed !important;
    }

    #video-recap-pause-popup .recap-action-button svg {
      width: 18px !important;
      height: 18px !important;
    }

    #video-recap-pause-popup .voiceover-row {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      margin-top: 12px !important;
      padding-top: 12px !important;
      border-top: 1px solid #e5e7eb !important;
      font-size: 14px !important;
      cursor: pointer !important;
      user-select: none !important;
    }

    #video-recap-pause-popup .error-text {
      margin: 10px 0 0 0 !important;
      font-size: 12px !important;
      color: #b00020 !important;
      line-height: 1.4 !important;
    }

    #video-recap-pause-popup .close-button {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      width: 28px !important;
      height: 28px !important;
      border: none !important;
      border-radius: 6px !important;
      background: transparent !important;
      color: #6b7280 !important;
      font-size: 20px !important;
      line-height: 1 !important;
      cursor: pointer !important;
    }

    #video-recap-pause-popup .close-button:hover {
      background: #f3f4f6 !important;
    }
  `;

  document.documentElement.appendChild(style);
}

function hideRecapPanel() {
  const panel = document.getElementById(RECAP_PANEL_ID);
  if (panel) {
    panel.remove();
  }
}

function hidePausePopup() {
  const popup = document.getElementById(PAUSE_POPUP_ID);
  if (popup) {
    popup.remove();
  }
}

function setPausePopupError(message) {
  const errorEl = document.querySelector(`#${PAUSE_POPUP_ID} .error-text`);
  if (errorEl) {
    errorEl.textContent = message || "";
  }
}

function setPausePopupLoading(isLoading) {
  const button = document.querySelector(`#${PAUSE_POPUP_ID} .recap-action-button`);
  const buttonText = document.querySelector(
    `#${PAUSE_POPUP_ID} .recap-action-button-text`
  );

  if (button) {
    button.disabled = isLoading;
  }

  if (buttonText) {
    buttonText.textContent = isLoading ? "Loading..." : "Recap";
  }
}

function showPausePopup() {
  if (isRecapPlaying || isSegmentPlaying) {
    return;
  }

  ensurePanelStyles();
  hidePausePopup();

  const popup = document.createElement("div");
  popup.id = PAUSE_POPUP_ID;
  popup.innerHTML = `
    <button class="close-button" type="button" aria-label="Close">×</button>
    <p class="popup-title">Video Recap</p>
    <p class="status-text">Paused at ${formatTime(lastPauseInfo.pausedAt)}. Ready for recap.</p>
    <button class="recap-action-button" type="button">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M1 4v6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span class="recap-action-button-text">Recap</span>
    </button>
    <label class="voiceover-row" for="video-recap-voiceover-checkbox">
      <input type="checkbox" id="video-recap-voiceover-checkbox" />
      <span>Voiceover</span>
    </label>
    <p class="error-text"></p>
  `;

  document.documentElement.appendChild(popup);

  popup.querySelector(".close-button")?.addEventListener("click", () => {
    hidePausePopup();
  });

  popup.querySelector(".recap-action-button")?.addEventListener("click", async () => {
    setPausePopupError("");
    setPausePopupLoading(true);

    const voiceoverCheckbox = popup.querySelector("#video-recap-voiceover-checkbox");
    const result = await startRecap(voiceoverCheckbox?.checked ?? false);

    if (result?.error) {
      setPausePopupLoading(false);
      setPausePopupError(result.error);
      return;
    }

    hidePausePopup();
  });
}

function showRecapPanel(title, text) {
  ensurePanelStyles();
  hideRecapPanel();

  const panel = document.createElement("div");
  panel.id = RECAP_PANEL_ID;
  panel.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(text)}</p>
  `;

  document.documentElement.appendChild(panel);
}

async function playKeyMomentSegment(index) {
  if (!lastRecapData || !videoElement || isSegmentPlaying || isRecapPlaying) {
    return;
  }

  const safeIndex = Math.max(
    0,
    Math.min(index, lastRecapData.keyMoments.length - 1)
  );
  const moment = lastRecapData.keyMoments[safeIndex];
  const clipDuration =
    lastRecapData.clipDurations[safeIndex] ??
    getClipDuration(moment, lastRecapData.pauseAt);

  const playButton = document.querySelector("#video-recap-play-segment");
  const prevButton = document.querySelector("#video-recap-prev");
  const nextButton = document.querySelector("#video-recap-next");

  [playButton, prevButton, nextButton].forEach((button) => {
    if (button) {
      button.disabled = true;
    }
  });

  if (playButton) {
    playButton.textContent = "Playing segment...";
  }

  isSegmentPlaying = true;
  stopVoiceover();

  try {
    videoElement.currentTime = moment.timestamp;
    await videoElement.play();
    await wait(clipDuration * 1000);
    suppressPausePopup = true;
    videoElement.pause();
  } finally {
    isSegmentPlaying = false;

    if (playButton) {
      playButton.disabled = false;
      playButton.textContent = "Play segment";
    }

    if (prevButton) {
      prevButton.disabled = safeIndex === 0;
    }

    if (nextButton) {
      nextButton.disabled = safeIndex === lastRecapData.keyMoments.length - 1;
    }

    setTimeout(() => {
      suppressPausePopup = false;
    }, 100);
  }
}

// After recap finishes, show arrows so the user can jump between key moments.
function showKeyMomentPanel(index) {
  if (!lastRecapData || !lastRecapData.keyMoments.length) {
    return;
  }

  const moments = lastRecapData.keyMoments;
  const safeIndex = Math.max(0, Math.min(index, moments.length - 1));
  const moment = moments[safeIndex];
  const total = moments.length;

  lastRecapData.currentIndex = safeIndex;

  if (videoElement) {
    videoElement.currentTime = moment.timestamp;
    videoElement.pause();
  }

  ensurePanelStyles();
  hideRecapPanel();

  const panel = document.createElement("div");
  panel.id = RECAP_PANEL_ID;
  panel.innerHTML = `
    <h3>${escapeHtml(
      `${formatTime(moment.timestamp)}–${formatTime(moment.endTime)} — ${moment.title}`
    )}</h3>
    <p>${escapeHtml(moment.description)}</p>
    <div class="video-recap-nav">
      <button id="video-recap-prev" type="button" ${
        safeIndex === 0 ? "disabled" : ""
      } aria-label="Previous key moment">←</button>
      <span>Key moment ${safeIndex + 1} of ${total}</span>
      <button id="video-recap-next" type="button" ${
        safeIndex === total - 1 ? "disabled" : ""
      } aria-label="Next key moment">→</button>
    </div>
    <button id="video-recap-play-segment" class="video-recap-play-segment" type="button">
      Play segment
    </button>
  `;

  document.documentElement.appendChild(panel);

  panel.querySelector("#video-recap-prev")?.addEventListener("click", () => {
    showKeyMomentPanel(safeIndex - 1);
  });

  panel.querySelector("#video-recap-next")?.addEventListener("click", () => {
    showKeyMomentPanel(safeIndex + 1);
  });

  panel.querySelector("#video-recap-play-segment")?.addEventListener("click", () => {
    playKeyMomentSegment(safeIndex);
  });
}

function requestRecapFromBackend(videoUrl, endTime) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "FETCH_RECAP",
        videoUrl: videoUrl,
        endTime: endTime,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      }
    );
  });
}

async function playHighlightRecap(video, keyMoments, narration, pauseAt) {
  isRecapPlaying = true;

  const moments = keyMoments
    .filter((moment) => moment.timestamp <= pauseAt)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (moments.length === 0) {
    isRecapPlaying = false;
    return { error: "No key moments found for this portion of the video." };
  }

  showRecapPanel(
    voiceoverEnabled ? "Playing recap with voiceover..." : "Playing recap...",
    narration || "Watch the key moments from what you viewed so far."
  );

  let wasMutedBeforeRecap = video.muted;

  if (voiceoverEnabled) {
    wasMutedBeforeRecap = muteVideoForVoiceover(video);
  }

  try {
    const clipDurations = buildClipDurations(moments, pauseAt);
    const narrationParts = voiceoverEnabled
      ? splitNarrationForClips(narration || "", moments.length)
      : [];

    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      const clipDuration = clipDurations[i];

      showRecapPanel(
        `${formatTime(moment.timestamp)}–${formatTime(moment.endTime)} — ${moment.title}`,
        moment.description
      );

      if (voiceoverEnabled) {
        window.speechSynthesis.cancel();

        const clipSpeech =
          narrationParts[i]?.trim() ||
          `${moment.title}. ${moment.description}`;

        const speechPromise = speakForClip(clipSpeech, clipDuration);

        video.currentTime = moment.timestamp;
        await video.play();
        await Promise.all([wait(clipDuration * 1000), speechPromise]);
        video.pause();
      } else {
        video.currentTime = moment.timestamp;
        await video.play();
        await wait(clipDuration * 1000);
        video.pause();
      }
    }

    video.currentTime = pauseAt;
    video.pause();

    lastRecapData = {
      keyMoments: moments,
      narration: narration || "",
      pauseAt: pauseAt,
      clipDurations: clipDurations,
      currentIndex: 0,
    };

    showKeyMomentPanel(0);

    return { ok: true };
  } finally {
    stopVoiceover();

    if (voiceoverEnabled) {
      restoreVideoAudio(video, wasMutedBeforeRecap);
    }

    isRecapPlaying = false;
  }
}

async function startRecap(useVoiceover) {
  voiceoverEnabled = useVoiceover;
  lastRecapData = null;
  hideRecapPanel();

  if (!videoElement) {
    return { error: "Could not find the video player." };
  }

  if (!videoElement.paused && !isRecapPlaying) {
    return { error: "Pause the video first." };
  }

  lastPauseInfo = {
    videoUrl: window.location.href,
    pausedAt: videoElement.currentTime,
  };

  const response = await requestRecapFromBackend(
    lastPauseInfo.videoUrl,
    lastPauseInfo.pausedAt
  );

  if (response.error) {
    return { error: response.error };
  }

  hidePausePopup();

  return playHighlightRecap(
    videoElement,
    response.keyMoments,
    response.narration,
    lastPauseInfo.pausedAt
  );
}

function attachVideoListeners(video) {
  video.addEventListener("pause", () => {
    if (isRecapPlaying || suppressPausePopup) {
      return;
    }

    lastPauseInfo = {
      videoUrl: window.location.href,
      pausedAt: video.currentTime,
    };

    console.log("Video paused at:", lastPauseInfo.pausedAt, "seconds");

    if (lastRecapData) {
      hidePausePopup();
      showKeyMomentPanel(lastRecapData.currentIndex);
      return;
    }

    showPausePopup();
  });

  video.addEventListener("play", () => {
    if (isRecapPlaying || isSegmentPlaying) {
      return;
    }

    stopVoiceover();
    hidePausePopup();
    hideRecapPanel();
  });
}

function trySetupVideo() {
  const video = document.querySelector("video");

  if (video) {
    videoElement = video;
  } else {
    return false;
  }

  if (!listenersAttached) {
    attachVideoListeners(video);
    listenersAttached = true;
  }

  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_STATUS") {
    sendResponse({
      ready: !!videoElement,
      paused: videoElement ? videoElement.paused : false,
      pausedAt: lastPauseInfo.pausedAt,
      isRecapPlaying: isRecapPlaying,
    });
    return;
  }

  if (message.type === "START_RECAP") {
    startRecap(message.voiceoverEnabled)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});

if (!trySetupVideo()) {
  const waitForVideo = setInterval(() => {
    if (trySetupVideo()) {
      clearInterval(waitForVideo);
    }
  }, 500);
}
