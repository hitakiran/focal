// NextResponse helps us send JSON data back to whoever called this API.
import { NextResponse } from "next/server";

// This package fetches YouTube captions for us.
import { fetchTranscript } from "youtube-transcript-plus";

// Every YouTube video has an ID that is exactly 11 characters long.
// Example: in https://youtube.com/watch?v=dQw4w9WgXcQ, the ID is "dQw4w9WgXcQ"
const VIDEO_ID_LENGTH = 11;

// This function takes a YouTube link and tries to pull out the video ID.
function getVideoIdFromUrl(videoUrl) {
  // Step 1: Make sure we actually got a non-empty string.
  if (typeof videoUrl !== "string" || videoUrl.trim() === "") {
    return null;
  }

  const url = videoUrl.trim();

  // Step 2: If the user pasted just the ID (like "dQw4w9WgXcQ"), return it.
  if (url.length === VIDEO_ID_LENGTH && !url.includes("/") && !url.includes(".")) {
    return url;
  }

  // Step 3: Try to read the URL and find the ID inside it.
  try {
    const parsedUrl = new URL(url);

    // For links like: https://youtu.be/dQw4w9WgXcQ
    if (parsedUrl.hostname.includes("youtu.be")) {
      const videoId = parsedUrl.pathname.replace("/", "");
      return videoId.length === VIDEO_ID_LENGTH ? videoId : null;
    }

    // For links like: https://youtube.com/watch?v=dQw4w9WgXcQ
    if (parsedUrl.hostname.includes("youtube.com")) {
      const videoId = parsedUrl.searchParams.get("v");
      if (videoId && videoId.length === VIDEO_ID_LENGTH) {
        return videoId;
      }

      // For links like: https://youtube.com/shorts/dQw4w9WgXcQ
      const pathParts = parsedUrl.pathname.split("/");
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart.length === VIDEO_ID_LENGTH) {
        return lastPart;
      }
    }
  } catch {
    // If URL parsing fails, the link format is not valid.
    return null;
  }

  return null;
}

// This is the main function that runs when someone sends a POST request
// to /api/transcript
export async function POST(request) {
  // Step 1: Read the JSON body from the request.
  // We expect something like: { "videoUrl": "https://youtube.com/watch?v=..." }
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const videoUrl = body.videoUrl;

  // Step 2: Check that videoUrl was provided.
  if (!videoUrl || typeof videoUrl !== "string" || videoUrl.trim() === "") {
    return NextResponse.json(
      { error: "Missing required field: videoUrl." },
      { status: 400 }
    );
  }

  // Step 3: Extract the video ID from the URL.
  const videoId = getVideoIdFromUrl(videoUrl);

  if (!videoId) {
    return NextResponse.json(
      { error: "Invalid YouTube URL. Please send a valid YouTube link." },
      { status: 400 }
    );
  }

  // Step 4: Ask youtube-transcript-plus to fetch the captions.
  try {
    const rawSegments = await fetchTranscript(videoId);

    // Step 5: Clean up the data into a simple format we can send back.
    // Each segment has: text (what was said), start (when it starts), duration (how long it lasts)
    const transcript = rawSegments.map((segment) => {
      return {
        text: segment.text,
        start: segment.offset, // the library calls this "offset", we rename it to "start"
        duration: segment.duration,
      };
    });

    // Step 6: Send back a success response.
    return NextResponse.json({
      videoId: videoId,
      transcript: transcript,
    });
  } catch (error) {
    // Step 7: If fetching failed, send back a helpful error message.
    // Status 400 = the request was bad (bad URL, no captions, etc.)
    // Status 500 = something went wrong on our/server side
    let errorMessage = "Failed to fetch transcript. Use manual paste instead.";
    let statusCode = 500;

    if (error.message) {
      errorMessage = error.message;
    }

    // These are common "expected" failures where manual paste makes sense.
    if (
      errorMessage.includes("disabled") ||
      errorMessage.includes("not available") ||
      errorMessage.includes("Invalid") ||
      errorMessage.includes("unavailable")
    ) {
      statusCode = 400;
      errorMessage = "No captions available for this video. Use manual paste instead.";
    }

    return NextResponse.json(
      {
        error: errorMessage,
        videoId: videoId,
      },
      { status: statusCode }
    );
  }
}
