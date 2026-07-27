// This file is a "content script."
// Chrome injects it into YouTube watch pages (see manifest.json).
//
// Why a content script?
// - It runs in the context of the web page (youtube.com).
// - Later, this is where we'll read video info from the page.
// - For now, we only log a message so you can confirm the extension works.

console.log("Video Recap extension loaded");
