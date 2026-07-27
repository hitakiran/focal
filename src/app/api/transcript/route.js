import { NextResponse } from "next/server";
import {
  fetchTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript-plus";

// YouTube video IDs are always 11 characters.
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(videoUrl) {
  if (typeof videoUrl !== "string" || !videoUrl.trim()) {
    return null;
  }

  const trimmed = videoUrl.trim();

  // Accept a bare video ID as well as full URLs.
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return VIDEO_ID_PATTERN.test(id) ? id : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");
        return id && VIDEO_ID_PATTERN.test(id) ? id : null;
      }

      const pathMatch = url.pathname.match(
        /^\/(embed|shorts|live)\/([a-zA-Z0-9_-]{11})/
      );
      if (pathMatch) {
        return pathMatch[2];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function transcriptErrorMessage(error) {
  if (error instanceof YoutubeTranscriptInvalidVideoIdError) {
    return "Invalid YouTube video ID or URL.";
  }
  if (error instanceof YoutubeTranscriptVideoUnavailableError) {
    return "This video is unavailable or has been removed.";
  }
  if (error instanceof YoutubeTranscriptDisabledError) {
    return "Captions are disabled for this video. Use manual paste instead.";
  }
  if (error instanceof YoutubeTranscriptNotAvailableError) {
    return "No captions are available for this video. Use manual paste instead.";
  }
  if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return "Captions are not available in the requested language.";
  }

  return "Failed to fetch transcript. Use manual paste instead.";
}

export async function POST(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const { videoUrl } = body;

  if (!videoUrl || typeof videoUrl !== "string" || !videoUrl.trim()) {
    return NextResponse.json(
      { error: "Missing required field: videoUrl." },
      { status: 400 }
    );
  }

  // Pull the 11-character ID out of watch, youtu.be, shorts, etc.
  const videoId = extractVideoId(videoUrl);

  if (!videoId) {
    return NextResponse.json(
      { error: "Invalid YouTube URL. Expected a watch, youtu.be, or shorts link." },
      { status: 400 }
    );
  }

  try {
    // youtube-transcript-plus talks to YouTube's caption API under the hood.
    const segments = await fetchTranscript(videoId);

    const transcript = segments.map(({ text, offset, duration }) => ({
      text,
      start: offset,
      duration,
    }));

    return NextResponse.json({ videoId, transcript });
  } catch (error) {
    const message = transcriptErrorMessage(error);
    const isClientError =
      error instanceof YoutubeTranscriptInvalidVideoIdError ||
      error instanceof YoutubeTranscriptVideoUnavailableError ||
      error instanceof YoutubeTranscriptDisabledError ||
      error instanceof YoutubeTranscriptNotAvailableError ||
      error instanceof YoutubeTranscriptNotAvailableLanguageError;

    return NextResponse.json(
      { error: message, videoId },
      { status: isClientError ? 400 : 500 }
    );
  }
}
