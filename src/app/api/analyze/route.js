import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

// Check that each transcript segment has the shape we expect.
function isValidSegment(segment) {
  return (
    segment &&
    typeof segment.text === "string" &&
    typeof segment.start === "number" &&
    typeof segment.duration === "number"
  );
}

// Keep only segments whose start time falls inside the watched range.
function filterTranscriptByTime(transcript, startTime, endTime) {
  return transcript.filter(
    (segment) => segment.start >= startTime && segment.start <= endTime
  );
}

// Claude sometimes wraps JSON in markdown code fences — strip those before parsing.
function parseClaudeJson(text) {
  const trimmed = text.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return JSON.parse(withoutFences);
}

// Make sure Claude's response has the fields we need.
function isValidAnalysis(data) {
  if (!data || typeof data !== "object") {
    return false;
  }

  if (!Array.isArray(data.keyMoments) || typeof data.narration !== "string") {
    return false;
  }

  return data.keyMoments.every(
    (moment) =>
      moment &&
      typeof moment.timestamp === "number" &&
      typeof moment.endTime === "number" &&
      typeof moment.title === "string" &&
      typeof moment.description === "string"
  );
}

// Fix or cap end times so each clip makes sense for playback.
function normalizeKeyMoments(keyMoments, watchedEndTime) {
  const sorted = [...keyMoments].sort((a, b) => a.timestamp - b.timestamp);
  const MAX_MOMENT_SECONDS = 12;

  return sorted.map((moment, index) => {
    let endTime = moment.endTime;

    // If Claude gave a bad end time, fall back to the next moment or pause point.
    if (typeof endTime !== "number" || endTime <= moment.timestamp) {
      const nextMoment = sorted[index + 1];
      endTime = nextMoment ? nextMoment.timestamp : watchedEndTime;
    }

    // Never play past what the user watched.
    endTime = Math.min(endTime, watchedEndTime);

    // Keep each highlight short — recap should feel quick.
    if (endTime - moment.timestamp > MAX_MOMENT_SECONDS) {
      endTime = moment.timestamp + MAX_MOMENT_SECONDS;
    }

    // Make sure each moment lasts at least 2 seconds.
    if (endTime - moment.timestamp < 2) {
      endTime = Math.min(moment.timestamp + 2, watchedEndTime);
    }

    return {
      ...moment,
      endTime: endTime,
    };
  });
}

export async function POST(request) {
  // Step 1: Read the JSON body from the request.
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const { transcript, startTime, endTime } = body;

  // Step 2: Validate the input fields.
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return NextResponse.json(
      { error: "Missing or empty transcript array." },
      { status: 400 }
    );
  }

  if (!transcript.every(isValidSegment)) {
    return NextResponse.json(
      {
        error:
          "Each transcript segment must include text, start, and duration.",
      },
      { status: 400 }
    );
  }

  if (typeof startTime !== "number" || typeof endTime !== "number") {
    return NextResponse.json(
      { error: "startTime and endTime must be numbers (in seconds)." },
      { status: 400 }
    );
  }

  if (startTime < 0 || endTime <= startTime) {
    return NextResponse.json(
      { error: "Invalid time range. endTime must be greater than startTime." },
      { status: 400 }
    );
  }

  // Step 3: Filter the transcript to the watched portion of the video.
  const filteredTranscript = filterTranscriptByTime(
    transcript,
    startTime,
    endTime
  );

  if (filteredTranscript.length === 0) {
    return NextResponse.json(
      {
        error: "No transcript segments found in the given time range.",
      },
      { status: 400 }
    );
  }

  // Step 4: Make sure the Anthropic API key is available.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Step 5: Build the prompt for Claude.
  const watchedSeconds = endTime - startTime;
  const momentCount =
    watchedSeconds < 120 ? "2-3" : watchedSeconds < 300 ? "3-4" : "4-5";

  const prompt = `You are analyzing part of a YouTube video transcript.

The viewer watched from ${startTime} seconds to ${endTime} seconds (${watchedSeconds} seconds total).

Here is the transcript for that range:
${JSON.stringify(filteredTranscript, null, 2)}

Your task:
1. Identify the ${momentCount} most important key moments in this range (fewer is better for short videos).
2. For each key moment, provide:
   - timestamp: when this important moment starts (seconds)
   - endTime: when this important moment ends (seconds) — keep clips SHORT (about 5-12 seconds each)
   - title: a short title (a few words)
   - description: one sentence explaining what happens
3. Write a short narration script (2-3 sentences) that connects these moments into a coherent recap.

Important rules:
- This is a QUICK recap, not a re-watch. Each clip should only cover the core idea.
- endTime must be greater than timestamp
- endTime must be ${endTime} or less (the viewer's pause point)
- Keep each moment focused: endTime should mark where the important idea finishes
- The total of all clip lengths combined should be well under ${Math.round(watchedSeconds * 0.3)} seconds

Respond with ONLY valid JSON. Do not include markdown, code fences, or any text before or after the JSON.

Use exactly this shape:
{
  "keyMoments": [
    { "timestamp": number, "endTime": number, "title": string, "description": string }
  ],
  "narration": string
}`;

  try {
    // Step 6: Send the filtered transcript to Claude.
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!responseText) {
      return NextResponse.json(
        { error: "Claude returned an empty response." },
        { status: 500 }
      );
    }

    // Step 7: Parse Claude's JSON response.
    let analysis;

    try {
      analysis = parseClaudeJson(responseText);
    } catch {
      return NextResponse.json(
        {
          error: "Claude returned invalid JSON. Try again.",
          rawResponse: responseText,
        },
        { status: 500 }
      );
    }

    if (!isValidAnalysis(analysis)) {
      return NextResponse.json(
        {
          error: "Claude's response did not match the expected format.",
          rawResponse: analysis,
        },
        { status: 500 }
      );
    }

    // Step 8: Clean up key moment times, then send the response back.
    const normalizedAnalysis = {
      narration: analysis.narration,
      keyMoments: normalizeKeyMoments(analysis.keyMoments, endTime),
    };

    return NextResponse.json(normalizedAnalysis);
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Failed to analyze transcript with Claude.",
      },
      { status: 500 }
    );
  }
}
