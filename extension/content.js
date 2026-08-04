// This file is a "content script."
// Chrome injects it into YouTube watch pages (see manifest.json).
//
// Why a content script?
// - It runs in the context of the web page (youtube.com).
// - Later, this is where we'll read video info from the page.

console.log("Video Recap extension loaded");

// A "video element" is a standard HTML tag: <video>
// YouTube uses one to actually play the video on the page.
// We find it with querySelector("video"), which searches the page for the first <video> tag.

// .currentTime is a property on a video element.
// It tells you how many seconds into the video the playback currently is.
// Example: if the video has been playing for 1 minute 30 seconds, currentTime is 90.

// An "event listener" is a way to run your code when something happens on the page.
// You call addEventListener("eventName", functionToRun).
// The browser calls your function automatically when that event occurs.

// A video element fires a "play" event when playback starts or resumes.
// It fires a "pause" event when playback stops (user clicked pause, or the video ended).

// Track whether we've already attached listeners, so we only do it once.
let listenersAttached = false;

function attachVideoListeners(video) {
  video.addEventListener("pause", () => {
    console.log("Video paused at:", video.currentTime, "seconds");
  });

  video.addEventListener("play", () => {
    console.log("Video resumed at:", video.currentTime, "seconds");
  });

  console.log("Video Recap: listening for play and pause events");
}

// Look for the video element on the page and attach listeners if we find it.
function trySetupVideo() {
  const video = document.querySelector("video");

  // Debug log: did we find the video element or not?
  if (video) {
    console.log("Video Recap: video element found:", video);
  } else {
    console.log("Video Recap: No video element found");
    return false;
  }

  // Only attach listeners once (even if this function runs again later).
  if (!listenersAttached) {
    attachVideoListeners(video);
    listenersAttached = true;
  }

  return true;
}

// YouTube loads parts of the page dynamically (after our script first runs).
// So the <video> tag might not exist yet on the first try.
// We check every 500ms until the video appears, then attach listeners and stop checking.
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
