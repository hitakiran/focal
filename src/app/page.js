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
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState("");

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
    </main>
  );
}
