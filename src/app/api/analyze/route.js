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
      typeof moment.title === "string" &&
      typeof moment.description === "string"
  );
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
  const prompt = `You are analyzing part of a YouTube video transcript.

The viewer watched from ${startTime} seconds to ${endTime} seconds.

Here is the transcript for that range:
${JSON.stringify(filteredTranscript, null, 2)}

Your task:
1. Identify the 4-6 most important key moments in this range.
2. For each key moment, provide:
   - timestamp: the time in seconds (number)
   - title: a short title (a few words)
   - description: one sentence explaining what happens
3. Write a short narration script (2-3 sentences) that connects these moments into a coherent recap and briefly mentions what happens between them.

Respond with ONLY valid JSON. Do not include markdown, code fences, or any text before or after the JSON.

Use exactly this shape:
{
  "keyMoments": [
    { "timestamp": number, "title": string, "description": string }
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

    // Step 8: Send the key moments and narration back to the caller.
    return NextResponse.json(analysis);
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Failed to analyze transcript with Claude.",
      },
      { status: 500 }
    );
  }
}
