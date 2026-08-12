// Focal — runs on YouTube watch pages (playback, recap, pause popup).

console.log("Focal extension loaded");

const RECAP_PANEL_ID = "video-recap-panel";
const PAUSE_POPUP_ID = "video-recap-pause-popup";

const MIN_CLIP_SECONDS = 3;
const MAX_CLIP_SECONDS = 12;
const MIN_WATCH_FOR_POPUP = 30;
const MIN_GAP_BETWEEN_POPUPS = 60;
const MAX_RECAP_WINDOW = 45 * 60;

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

// Where the next default recap should start (advanced when user resumes after pausing).
let recapCheckpointAt = 0;
let lastPauseVideoTime = null;
let hasPlayedFromBeginning = false;
let midVideoResume = false;
let pauseClusterStartAt = 0;

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

function formatMomentTitle(moment) {
  return `${moment.title} (${formatTime(moment.timestamp)}–${formatTime(moment.endTime)})`;
}

function resetSessionForNewVideo() {
  recapCheckpointAt = 0;
  lastPauseVideoTime = null;
  lastRecapData = null;
  hasPlayedFromBeginning = false;
  midVideoResume = false;
  pauseClusterStartAt = 0;
}

function updatePauseCluster(pausedAt) {
  if (
    lastPauseVideoTime !== null &&
    pausedAt - lastPauseVideoTime < MIN_GAP_BETWEEN_POPUPS
  ) {
    return;
  }

  pauseClusterStartAt = midVideoResume ? 0 : recapCheckpointAt;
}

function getEffectiveRecapCheckpoint(pausedAt) {
  if (midVideoResume) {
    return 0;
  }

  // Quick re-pause soon after the last one — merge into the wider recap (e.g. 0→7:20, not 7:00→7:20).
  if (
    lastPauseVideoTime !== null &&
    pausedAt - lastPauseVideoTime < MIN_GAP_BETWEEN_POPUPS
  ) {
    return pauseClusterStartAt;
  }

  if (recapCheckpointAt <= 0) {
    return 0;
  }

  // Too little watched since checkpoint — use the cluster start instead.
  if (pausedAt - recapCheckpointAt < MIN_GAP_BETWEEN_POPUPS) {
    return pauseClusterStartAt;
  }

  return recapCheckpointAt;
}

function shouldAutoShowPausePopup(pausedAt) {
  if (pausedAt < MIN_WATCH_FOR_POPUP) {
    return false;
  }

  if (
    lastPauseVideoTime !== null &&
    pausedAt - lastPauseVideoTime < MIN_GAP_BETWEEN_POPUPS
  ) {
    return false;
  }

  return true;
}

function resolveRecapRange(recapRange, endTime) {
  let startTime =
    recapRange === "from_start" ? 0 : getEffectiveRecapCheckpoint(endTime);

  // If the user rewound, fall back to from-start rather than an empty range.
  if (startTime > endTime) {
    startTime = 0;
  }

  startTime = Math.max(0, Math.min(startTime, endTime));

  if (endTime - startTime > MAX_RECAP_WINDOW) {
    startTime = endTime - MAX_RECAP_WINDOW;
  }

  return { startTime, endTime };
}

function buildRecapRangeOptionsHtml(pausedAt) {
  const checkpoint = getEffectiveRecapCheckpoint(pausedAt);

  if (checkpoint <= 0 || pausedAt - checkpoint < MIN_GAP_BETWEEN_POPUPS) {
    return "";
  }

  return `
    <div class="recap-range-options">
      <label class="recap-range-row">
        <input type="radio" name="recap-range" value="since_checkpoint" checked />
        <span>Since last pause (${formatTime(checkpoint)} – ${formatTime(pausedAt)})</span>
      </label>
      <label class="recap-range-row">
        <input type="radio" name="recap-range" value="from_start" />
        <span>From beginning (0:00 – ${formatTime(pausedAt)})</span>
      </label>
    </div>
  `;
}

function getSelectedRecapRange(container) {
  const selected = container?.querySelector('input[name="recap-range"]:checked');
  return selected?.value === "from_start" ? "from_start" : "since_checkpoint";
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

function ensureBrandFont() {
  if (document.getElementById("focal-brand-font")) {
    return;
  }

  const link = document.createElement("link");
  link.id = "focal-brand-font";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
  document.documentElement.appendChild(link);
}

function ensurePanelStyles() {
  ensureBrandFont();

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
      background: #0b1222 !important;
      color: #ffffff !important;
      border-radius: 12px !important;
      padding: 16px !important;
      font-family: Inter, system-ui, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.5 !important;
    }

    #video-recap-panel h3 {
      margin: 0 0 8px 0 !important;
      font-size: 15px !important;
    }

    #video-recap-panel p {
      margin: 0 0 12px 0 !important;
      color: #e2e8f0 !important;
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
      color: #cbd5e1 !important;
      white-space: nowrap !important;
    }

    .video-recap-play-segment {
      width: 100% !important;
      margin-top: 12px !important;
      padding: 10px 14px !important;
      border: none !important;
      border-radius: 8px !important;
      background: #595fe7 !important;
      color: #ffffff !important;
      font-family: Inter, system-ui, sans-serif !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
    }

    .video-recap-play-segment:hover:not(:disabled) {
      background: #4a50d4 !important;
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
      color: #0b1222 !important;
      border-radius: 12px !important;
      padding: 16px !important;
      font-family: Inter, system-ui, sans-serif !important;
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
      background: #595fe7 !important;
      color: #ffffff !important;
      font-family: Inter, system-ui, sans-serif !important;
      font-size: 15px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      box-shadow: 0 2px 8px rgba(89, 95, 231, 0.35) !important;
    }

    #video-recap-pause-popup .recap-action-button:hover:not(:disabled) {
      background: #4a50d4 !important;
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

    #video-recap-voiceover-checkbox {
      width: 16px !important;
      height: 16px !important;
      accent-color: #595fe7 !important;
      cursor: pointer !important;
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

    .recap-range-options {
      margin-bottom: 12px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 8px !important;
    }

    .recap-range-row {
      display: flex !important;
      align-items: flex-start !important;
      gap: 8px !important;
      font-size: 13px !important;
      line-height: 1.4 !important;
      cursor: pointer !important;
    }

    .recap-range-row input {
      margin-top: 2px !important;
      accent-color: #595fe7 !important;
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
    <p class="popup-title">Focal</p>
    <p class="status-text">Paused at ${formatTime(lastPauseInfo.pausedAt)}. Ready for recap?</p>
    ${buildRecapRangeOptionsHtml(lastPauseInfo.pausedAt)}
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
    const recapRange = getSelectedRecapRange(popup);
    const result = await startRecap(voiceoverCheckbox?.checked ?? false, recapRange);

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
    <h3>${escapeHtml(formatMomentTitle(moment))}</h3>
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

function requestRecapFromBackend(videoUrl, startTime, endTime) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "FETCH_RECAP",
        videoUrl: videoUrl,
        startTime: startTime,
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

async function playHighlightRecap(video, keyMoments, narration, pauseAt, startTime) {
  isRecapPlaying = true;

  const moments = keyMoments
    .filter(
      (moment) =>
        moment.timestamp >= startTime && moment.timestamp <= pauseAt
    )
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

      showRecapPanel(formatMomentTitle(moment), moment.description);

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
      startTime: startTime,
      clipDurations: clipDurations,
      currentIndex: 0,
    };

    recapCheckpointAt = pauseAt;
    midVideoResume = false;
    pauseClusterStartAt = pauseAt;

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

async function startRecap(useVoiceover, recapRange = "since_checkpoint") {
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

  const { startTime, endTime } = resolveRecapRange(
    recapRange,
    lastPauseInfo.pausedAt
  );

  if (endTime - startTime < 5) {
    return {
      error: "Watch a bit more of the video before running a recap.",
    };
  }

  const response = await requestRecapFromBackend(
    lastPauseInfo.videoUrl,
    startTime,
    endTime
  );

  if (response.error) {
    return { error: response.error };
  }

  hidePausePopup();

  return playHighlightRecap(
    videoElement,
    response.keyMoments,
    response.narration,
    endTime,
    startTime
  );
}

function attachVideoListeners(video) {
  video.addEventListener("pause", () => {
    if (isRecapPlaying || suppressPausePopup) {
      return;
    }

    const videoUrl = window.location.href;

    if (lastPauseInfo.videoUrl && lastPauseInfo.videoUrl !== videoUrl) {
      resetSessionForNewVideo();
    }

    const pausedAt = video.currentTime;

    lastPauseInfo = {
      videoUrl: videoUrl,
      pausedAt: pausedAt,
    };

    console.log("Video paused at:", pausedAt, "seconds");

    if (lastRecapData) {
      hidePausePopup();
      showKeyMomentPanel(lastRecapData.currentIndex);
      lastPauseVideoTime = pausedAt;
      return;
    }

    if (shouldAutoShowPausePopup(pausedAt)) {
      showPausePopup();
    } else {
      hidePausePopup();
    }

    updatePauseCluster(pausedAt);
    lastPauseVideoTime = pausedAt;
  });

  video.addEventListener("seeked", () => {
    if (isRecapPlaying || isSegmentPlaying) {
      return;
    }

    const currentTime = video.currentTime;

    if (!hasPlayedFromBeginning && currentTime >= MIN_WATCH_FOR_POPUP) {
      midVideoResume = true;
      recapCheckpointAt = 0;
    }
  });

  video.addEventListener("play", () => {
    if (isRecapPlaying || isSegmentPlaying) {
      return;
    }

    const currentTime = video.currentTime;

    if (currentTime < MIN_WATCH_FOR_POPUP) {
      hasPlayedFromBeginning = true;
      midVideoResume = false;
    } else if (midVideoResume && lastPauseVideoTime !== null) {
      // Resumed after a pause during a mid-video jump — switch to normal tracking.
      midVideoResume = false;
      recapCheckpointAt = currentTime;
    } else if (midVideoResume) {
      recapCheckpointAt = 0;
    } else if (!hasPlayedFromBeginning && currentTime >= MIN_WATCH_FOR_POPUP) {
      midVideoResume = true;
      recapCheckpointAt = 0;
    } else {
      recapCheckpointAt = currentTime;
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
    const effectiveCheckpoint = getEffectiveRecapCheckpoint(lastPauseInfo.pausedAt);

    sendResponse({
      ready: !!videoElement,
      paused: videoElement ? videoElement.paused : false,
      pausedAt: lastPauseInfo.pausedAt,
      recapCheckpointAt: effectiveCheckpoint,
      showRecapRangeOptions:
        effectiveCheckpoint > 0 &&
        lastPauseInfo.pausedAt - effectiveCheckpoint >= MIN_GAP_BETWEEN_POPUPS,
      isRecapPlaying: isRecapPlaying,
    });
    return;
  }

  if (message.type === "START_RECAP") {
    startRecap(message.voiceoverEnabled, message.recapRange || "since_checkpoint")
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

// YouTube is a single-page app — reset checkpoints when the user navigates to a new video.
let lastKnownVideoUrl = window.location.href;
setInterval(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastKnownVideoUrl) {
    lastKnownVideoUrl = currentUrl;
    resetSessionForNewVideo();
    hidePausePopup();
    hideRecapPanel();
  }
}, 1000);
