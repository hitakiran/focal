// This file is a "content script."
// Chrome injects it into YouTube watch pages (see manifest.json).
//
// Phase 0: Show a "Recap" button when the user pauses.
// Phase 1: Clicking Recap plays highlight clips.
// Phase 2: Optional voiceover reads the narration while clips play.

console.log("Video Recap extension loaded (Phase 2: optional voiceover)");

const RECAP_CONTROLS_ID = "video-recap-controls";
const RECAP_BUTTON_ID = "video-recap-button";
const RECAP_VOICEOVER_ID = "video-recap-voiceover";
const RECAP_PANEL_ID = "video-recap-panel";

const MIN_CLIP_SECONDS = 3;
const MAX_CLIP_SECONDS = 12;

let listenersAttached = false;
let videoElement = null;
let isRecapPlaying = false;

// User choice: off by default (video-only recap unless they turn this on).
let voiceoverEnabled = false;

let lastPauseInfo = {
  videoUrl: "",
  pausedAt: 0,
};

function getRecapBudget(pauseAt) {
  const target = pauseAt * 0.25;
  return Math.min(60, Math.max(20, target));
}

function buildClipDurations(moments, pauseAt) {
  const rawDurations = moments.map((moment) => getClipDuration(moment, pauseAt));
  const budget = getRecapBudget(pauseAt);
  const total = rawDurations.reduce((sum, duration) => sum + duration, 0);

  console.log(
    "Video Recap: raw recap length",
    total.toFixed(1),
    "sec, budget",
    budget.toFixed(1),
    "sec"
  );

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

// Split the full narration into one part per clip.
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

// Speak one clip's narration at a speed that fits that clip's length.
function speakForClip(text, clipDurationSeconds) {
  return new Promise((resolve) => {
    if (!text?.trim() || !window.speechSynthesis) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text.trim());
    const wordCount = text.trim().split(/\s+/).length;

    // Rough guess: at normal speed, people speak about 2 words per second.
    const naturalDurationSeconds = wordCount / 2;
    let rate = naturalDurationSeconds / clipDurationSeconds;

    // Keep speech slower and clearer — never rush the narrator.
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

// When voiceover is on, mute the YouTube video so only the narrator is heard.
function muteVideoForVoiceover(video) {
  const wasMuted = video.muted;
  video.muted = true;
  console.log("Video Recap: video muted during voiceover");
  return wasMuted;
}

function restoreVideoAudio(video, wasMuted) {
  video.muted = wasMuted;
  console.log("Video Recap: video audio restored");
}

function ensureStyles() {
  if (document.getElementById("video-recap-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "video-recap-styles";
  style.textContent = `
    #video-recap-controls {
      position: fixed !important;
      top: 80px !important;
      right: 20px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      gap: 8px !important;
      font-family: Arial, sans-serif !important;
    }

    #video-recap-button {
      padding: 10px 16px !important;
      border: none !important;
      border-radius: 999px !important;
      background: #ff0000 !important;
      color: #ffffff !important;
      font-size: 14px !important;
      font-weight: bold !important;
      cursor: pointer !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25) !important;
    }

    #video-recap-button:disabled {
      opacity: 0.7 !important;
      cursor: wait !important;
    }

    #video-recap-voiceover-label {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 8px 12px !important;
      border-radius: 999px !important;
      background: rgba(0, 0, 0, 0.75) !important;
      color: #ffffff !important;
      font-size: 13px !important;
      cursor: pointer !important;
      user-select: none !important;
    }

    #video-recap-voiceover {
      width: 16px !important;
      height: 16px !important;
      cursor: pointer !important;
    }

    #video-recap-panel {
      position: fixed !important;
      bottom: 24px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2147483647 !important;
      width: min(90%, 520px) !important;
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
      font-size: 16px !important;
    }

    #video-recap-panel p {
      margin: 0 !important;
      color: #eeeeee !important;
    }
  `;

  document.documentElement.appendChild(style);
}

function hideRecapControls() {
  const controls = document.getElementById(RECAP_CONTROLS_ID);
  if (controls) {
    controls.remove();
  }
}

function hideRecapPanel() {
  const panel = document.getElementById(RECAP_PANEL_ID);
  if (panel) {
    panel.remove();
  }
}

function showRecapPanel(title, text) {
  ensureStyles();
  hideRecapPanel();

  const panel = document.createElement("div");
  panel.id = RECAP_PANEL_ID;
  panel.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(text)}</p>
  `;

  document.documentElement.appendChild(panel);
}

function showRecapControls(onRecapClick) {
  ensureStyles();
  hideRecapControls();

  const controls = document.createElement("div");
  controls.id = RECAP_CONTROLS_ID;

  const button = document.createElement("button");
  button.id = RECAP_BUTTON_ID;
  button.type = "button";
  button.textContent = "Recap";
  button.addEventListener("click", onRecapClick);

  const label = document.createElement("label");
  label.id = "video-recap-voiceover-label";
  label.setAttribute("for", RECAP_VOICEOVER_ID);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = RECAP_VOICEOVER_ID;
  checkbox.checked = voiceoverEnabled;
  checkbox.addEventListener("change", () => {
    voiceoverEnabled = checkbox.checked;
    console.log("Video Recap: voiceover", voiceoverEnabled ? "on" : "off");
  });

  const labelText = document.createElement("span");
  labelText.textContent = "Voiceover";

  label.appendChild(checkbox);
  label.appendChild(labelText);

  controls.appendChild(button);
  controls.appendChild(label);

  document.documentElement.appendChild(controls);
  console.log("Video Recap: controls shown (Recap + Voiceover option)");
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
  hideRecapControls();

  const moments = keyMoments
    .filter((moment) => moment.timestamp <= pauseAt)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (moments.length === 0) {
    isRecapPlaying = false;
    alert("No key moments found for this portion of the video.");
    showRecapControls(handleRecapClick);
    return;
  }

  console.log("Video Recap: playing", moments.length, "highlight clips");

  showRecapPanel(
    voiceoverEnabled ? "Playing recap with voiceover..." : "Playing recap...",
    narration || "Watch the key moments from what you viewed so far."
  );

  // Only use voiceover if the user turned it on.
  let wasMutedBeforeRecap = video.muted;

  if (voiceoverEnabled) {
    wasMutedBeforeRecap = muteVideoForVoiceover(video);
  }

  try {
    const clipDurations = buildClipDurations(moments, pauseAt);
    const totalRecapSeconds = clipDurations.reduce((sum, duration) => sum + duration, 0);
    const narrationParts = voiceoverEnabled
      ? splitNarrationForClips(narration || "", moments.length)
      : [];

    console.log("Video Recap: final recap length", totalRecapSeconds.toFixed(1), "seconds");

    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      const clipDuration = clipDurations[i];

      console.log(
        "Video Recap: clip",
        i + 1,
        formatTime(moment.timestamp),
        "to",
        formatTime(moment.endTime),
        "(",
        clipDuration.toFixed(1),
        "sec ) -",
        moment.title
      );

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

    showRecapPanel(
      `Recap complete (~${Math.round(totalRecapSeconds)} sec, stopped at ${formatTime(pauseAt)})`,
      narration || "You finished the highlight recap."
    );

    console.log("Video Recap: highlight recap finished");
  } finally {
    stopVoiceover();

    if (voiceoverEnabled) {
      restoreVideoAudio(video, wasMutedBeforeRecap);
    }

    isRecapPlaying = false;
    showRecapControls(handleRecapClick);
  }
}

async function handleRecapClick() {
  const button = document.getElementById(RECAP_BUTTON_ID);

  if (!videoElement) {
    alert("Could not find the video player.");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Loading...";
  }

  console.log("Video Recap: fetching key moments from backend...");

  const response = await requestRecapFromBackend(
    lastPauseInfo.videoUrl,
    lastPauseInfo.pausedAt
  );

  if (response.error) {
    alert(response.error);
    if (button) {
      button.disabled = false;
      button.textContent = "Recap";
    }
    return;
  }

  console.log("Video Recap: key moments received:", response.keyMoments);

  await playHighlightRecap(
    videoElement,
    response.keyMoments,
    response.narration,
    lastPauseInfo.pausedAt
  );
}

function attachVideoListeners(video) {
  video.addEventListener("pause", () => {
    if (isRecapPlaying) {
      return;
    }

    lastPauseInfo = {
      videoUrl: window.location.href,
      pausedAt: video.currentTime,
    };

    console.log("Video paused at:", lastPauseInfo.pausedAt, "seconds");
    showRecapControls(handleRecapClick);
  });

  video.addEventListener("play", () => {
    if (isRecapPlaying) {
      return;
    }

    console.log("Video resumed at:", video.currentTime, "seconds");
    stopVoiceover();
    hideRecapControls();
    hideRecapPanel();
  });

  console.log("Video Recap: listening for play and pause events");
}

function trySetupVideo() {
  const video = document.querySelector("video");

  if (video) {
    videoElement = video;
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
