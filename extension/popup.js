const statusText = document.getElementById("status-text");
const recapButton = document.getElementById("recap-button");
const recapButtonText = document.getElementById("recap-button-text");
const voiceoverCheckbox = document.getElementById("voiceover-checkbox");
const errorText = document.getElementById("error-text");
const recapRangeSection = document.getElementById("recap-range-section");
const sinceCheckpointLabel = document.getElementById("since-checkpoint-label");
const fromStartLabel = document.getElementById("from-start-label");

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function showError(message) {
  errorText.textContent = message;
}

function clearError() {
  errorText.textContent = "";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendMessageToPage(message) {
  const tab = await getActiveTab();

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  if (!tab.url?.includes("youtube.com/watch")) {
    throw new Error("Open a YouTube video page first.");
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Reload the YouTube page and try again."));
        return;
      }
      resolve(response);
    });
  });
}

function getSelectedRecapRange() {
  const selected = document.querySelector('input[name="recap-range"]:checked');
  return selected?.value === "from_start" ? "from_start" : "since_checkpoint";
}

function updateRecapRangeOptions(status) {
  if (!status.showRecapRangeOptions) {
    recapRangeSection.hidden = true;
    return;
  }

  recapRangeSection.hidden = false;
  sinceCheckpointLabel.textContent = `Since last pause (${formatTime(status.recapCheckpointAt)} – ${formatTime(status.pausedAt)})`;
  fromStartLabel.textContent = `From beginning (0:00 – ${formatTime(status.pausedAt)})`;
}

async function refreshStatus() {
  clearError();

  try {
    const status = await sendMessageToPage({ type: "GET_STATUS" });

    if (status.isRecapPlaying) {
      statusText.textContent = "Recap is playing on the video page.";
      recapButton.disabled = true;
      recapRangeSection.hidden = true;
      return;
    }

    if (!status.ready) {
      statusText.textContent = "Waiting for the YouTube player to load...";
      recapButton.disabled = true;
      recapRangeSection.hidden = true;
      return;
    }

    if (!status.paused) {
      statusText.textContent = "Pause the video, then open this popup again.";
      recapButton.disabled = true;
      recapRangeSection.hidden = true;
      return;
    }

    statusText.textContent = `Paused at ${formatTime(status.pausedAt)}. Ready for recap?`;
    updateRecapRangeOptions(status);
    recapButton.disabled = false;
  } catch (error) {
    statusText.textContent = "Open a YouTube watch page to use Focal.";
    recapButton.disabled = true;
    recapRangeSection.hidden = true;
    showError(error.message);
  }
}

recapButton.addEventListener("click", async () => {
  clearError();
  recapButton.disabled = true;
  recapButtonText.textContent = "Loading...";

  try {
    const response = await sendMessageToPage({
      type: "START_RECAP",
      voiceoverEnabled: voiceoverCheckbox.checked,
      recapRange: getSelectedRecapRange(),
    });

    if (response?.error) {
      showError(response.error);
      recapButton.disabled = false;
      recapButtonText.textContent = "Recap";
      return;
    }

    window.close();
  } catch (error) {
    showError(error.message);
    recapButton.disabled = false;
    recapButtonText.textContent = "Recap";
  }
});

refreshStatus();
