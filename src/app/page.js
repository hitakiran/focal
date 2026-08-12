"use client";

import Image from "next/image";
import { useState } from "react";

// Turn seconds (like 220) into mm:ss (like "3:40")
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// Turn mm:ss input (like "3:40") into total seconds (like 220)
function parseTimeInput(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+):(\d{2})$/);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);

  if (seconds >= 60) {
    return null;
  }

  return minutes * 60 + seconds;
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

    const endTime = parseTimeInput(stoppedAt);

    if (endTime === null || endTime <= 0) {
      setAnalyzeError(
        'Invalid time format. Use mm:ss (e.g. "3:40" or "0:45").'
      );
      return;
    }

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
          endTime,
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

  const inputClassName =
    "w-full rounded-xl border border-focal-accent/20 bg-[#111827] px-4 py-2.5 text-white placeholder:text-focal-label outline-none focus:border-focal-accent";
  const buttonClassName =
    "rounded-xl bg-focal-primary px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-focal-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
  const cardClassName =
    "rounded-xl border border-focal-accent/20 bg-white/5 p-4";
  const errorClassName =
    "rounded-xl border border-red-400/30 bg-red-950/40 p-4 text-red-200";

  return (
    <div className="flex min-h-full flex-col bg-focal-ink text-white">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <Image
            src="/focal-logo.png"
            alt="Focal"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <span className="text-xl font-bold tracking-[-0.02em]">Focal</span>
        </div>
        <a
          href="https://github.com/hitakiran/focal"
          className="text-[15px] font-semibold text-focal-accent hover:text-white"
        >
          GitHub
        </a>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 pb-20">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-wide text-focal-label">
            Developer tools
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em]">
            Transcript API Tester
          </h1>
          <p className="mt-2 text-focal-accent">
            Paste a YouTube URL and click the button to test your API.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className={inputClassName}
          />
          <button
            type="button"
            onClick={handleGetTranscript}
            disabled={loading || videoUrl.trim() === ""}
            className={`${buttonClassName} shrink-0`}
          >
            Get Transcript
          </button>
        </div>

        {loading && <p className="text-focal-accent">Loading...</p>}

        {error && <div className={errorClassName}>{error}</div>}

        {transcript.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              Transcript ({transcript.length} segments)
            </h2>
            <ul className={`flex max-h-[60vh] flex-col gap-2 overflow-y-auto ${cardClassName}`}>
              {transcript.map((segment, index) => (
                <li
                  key={`${segment.start}-${index}`}
                  className="border-b border-focal-accent/15 pb-2 last:border-b-0"
                >
                  <span className="mr-3 font-mono text-sm text-focal-accent">
                    {formatTime(segment.start)}
                  </span>
                  <span className="text-white/90">{segment.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-focal-accent/20 pt-8">
          <h2 className="text-lg font-semibold">Analyze watched portion</h2>
          <p className="text-sm text-focal-accent">
            Simulates a first-time viewer who started at 0 and paused partway
            through.
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Time you stopped</span>
            <input
              type="text"
              value={stoppedAt}
              onChange={(event) => setStoppedAt(event.target.value)}
              placeholder="e.g. 3:40"
              className={inputClassName}
            />
          </label>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={
              analyzeLoading ||
              transcript.length === 0 ||
              stoppedAt.trim() === ""
            }
            className={`w-fit ${buttonClassName}`}
          >
            Analyze
          </button>
        </div>

        {analyzeLoading && <p className="text-focal-accent">Analyzing...</p>}

        {analyzeError && <div className={errorClassName}>{analyzeError}</div>}

        {keyMoments.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Key moments</h2>
            <ul className={`flex flex-col gap-2 ${cardClassName}`}>
              {keyMoments.map((moment, index) => (
                <li
                  key={`${moment.time ?? moment.start}-${index}`}
                  className="border-b border-focal-accent/15 pb-2 last:border-b-0"
                >
                  <span className="mr-3 font-mono text-sm text-focal-accent">
                    {moment.endTime != null
                      ? `${formatTime(moment.timestamp ?? moment.time ?? moment.start ?? 0)}–${formatTime(moment.endTime)}`
                      : formatTime(moment.timestamp ?? moment.time ?? moment.start ?? 0)}
                  </span>
                  <span className="text-white/90">
                    {moment.text ?? moment.description ?? moment.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {narration && (
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Narration</h2>
            <p className={`${cardClassName} text-white/90`}>{narration}</p>
          </div>
        )}
      </main>
    </div>
  );
}
