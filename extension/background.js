// This is the extension's "background service worker."
// It runs separately from the YouTube page (not inside youtube.com).
//
// Why do we need this?
// Chrome blocks youtube.com from calling localhost directly (security rule).
// So the content script asks THIS file to make the API calls instead.

// Our Next.js app runs locally while we develop.
// Make sure you run "npm run dev" in your project folder first!
const API_BASE_URL = "http://localhost:3000";

async function fetchRecap(videoUrl, endTime) {
  // --- Part A: Get the video's transcript (captions) ---
  const transcriptResponse = await fetch(`${API_BASE_URL}/api/transcript`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ videoUrl }),
  });

  const transcriptData = await transcriptResponse.json();

  if (!transcriptResponse.ok) {
    return { error: transcriptData.error || "Failed to fetch transcript." };
  }

  // --- Part B: Ask Claude to analyze the watched portion ---
  const analyzeResponse = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transcript: transcriptData.transcript,
      startTime: 0,
      endTime: endTime,
    }),
  });

  const analyzeData = await analyzeResponse.json();

  if (!analyzeResponse.ok) {
    return { error: analyzeData.error || "Failed to analyze transcript." };
  }

  return {
    transcriptCount: transcriptData.transcript.length,
    keyMoments: analyzeData.keyMoments,
    narration: analyzeData.narration,
  };
}

// Listen for messages sent from content.js.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "FETCH_RECAP") {
    return;
  }

  fetchRecap(message.videoUrl, message.endTime)
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      sendResponse({
        error:
          error.message ||
          "Could not reach backend. Is 'npm run dev' running?",
      });
    });

  // Return true to tell Chrome we will send a response asynchronously.
  return true;
});
