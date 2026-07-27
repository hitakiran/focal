"use client";

import { useState } from "react";

// Turn seconds (like 65.4) into a readable time (like "1:05")
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [videoUrl, setVideoUrl] = useState("");
  const [stoppedAt, setStoppedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [keyMoments, setKeyMoments] = useState([]);
  const [narration, setNarration] = useState("");
  const [error, setError] = useState("");
  const [analyzeError, setAnalyzeError] = useState("");

  async function handleGetTranscript() {
    // Clear old results before starting a new request.
    setError("");
    setTranscript([]);
    setLoading(true);

    try {
      const response = await fetch("/api/transcript", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      setTranscript(data.transcript || []);
    } catch {
      setError("Could not reach the server. Is the app running?");
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze() {
    setAnalyzeError("");
    setKeyMoments([]);
    setNarration("");
    setAnalyzeLoading(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript,
          startTime: 0,
          endTime: Number(stoppedAt),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setAnalyzeError(data.error || "Something went wrong.");
        return;
      }

      setKeyMoments(data.keyMoments || []);
      setNarration(data.narration || "");
    } catch {
      setAnalyzeError("Could not reach the server. Is the app running?");
    } finally {
      setAnalyzeLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Transcript API Tester</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Paste a YouTube URL and click the button to test your API.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          onClick={handleGetTranscript}
          disabled={loading || videoUrl.trim() === ""}
          className="rounded-lg bg-black px-5 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Get Transcript
        </button>
      </div>

      {loading && <p className="text-zinc-600 dark:text-zinc-400">Loading...</p>}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {transcript.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">
            Transcript ({transcript.length} segments)
          </h2>
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            {transcript.map((segment, index) => (
              <li
                key={`${segment.start}-${index}`}
                className="border-b border-zinc-100 pb-2 last:border-b-0 dark:border-zinc-800"
              >
                <span className="mr-3 font-mono text-sm text-zinc-500">
                  {formatTime(segment.start)}
                </span>
                <span>{segment.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Analyze watched portion</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Simulates a first-time viewer who started at 0 and paused partway
          through.
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Time you stopped (seconds)</span>
          <input
            type="number"
            min="0"
            value={stoppedAt}
            onChange={(event) => setStoppedAt(event.target.value)}
            placeholder="e.g. 120"
            className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={
            analyzeLoading ||
            transcript.length === 0 ||
            stoppedAt === "" ||
            Number(stoppedAt) <= 0
          }
          className="w-fit rounded-lg bg-black px-5 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Analyze
        </button>
      </div>

      {analyzeLoading && (
        <p className="text-zinc-600 dark:text-zinc-400">Analyzing...</p>
      )}

      {analyzeError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {analyzeError}
        </div>
      )}

      {keyMoments.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Key moments</h2>
          <ul className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            {keyMoments.map((moment, index) => (
              <li
                key={`${moment.time ?? moment.start}-${index}`}
                className="border-b border-zinc-100 pb-2 last:border-b-0 dark:border-zinc-800"
              >
                <span className="mr-3 font-mono text-sm text-zinc-500">
                  {formatTime(moment.timestamp ?? moment.time ?? moment.start ?? 0)}
                </span>
                <span>{moment.text ?? moment.description ?? moment.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {narration && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Narration</h2>
          <p className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            {narration}
          </p>
        </div>
      )}
    </main>
  );
}
