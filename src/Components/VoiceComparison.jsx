import { useEffect, useId, useRef, useState } from "react";
import {
  createVoiceComparisonClient,
  getVoiceErrorMessage,
} from "../voice/voiceComparisonClient.js";
import { MAX_AUDIO_BYTES } from "../voice/audio.js";

const CAPTURE_SECONDS = 10;
const slots = [
  { key: "reference", title: "Reference voice", description: "A recording of the person you know." },
  { key: "test", title: "Test voice", description: "The recording you want to compare." },
];
const buttonClasses =
  "inline-flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400";
const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-full border border-indigo-300 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-600 dark:text-indigo-200 dark:hover:bg-indigo-900/40";

function releaseMicrophone(session) {
  clearTimeout(session.timer);
  session.timer = null;
  const stream = session.stream;
  session.stream = null;
  stream?.getTracks().forEach((track) => track.stop());
}

function discardSession(session) {
  if (!session) return;
  session.cancelled = true;
  releaseMicrophone(session);
  if (session.recorder) {
    session.recorder.ondataavailable = null;
    session.recorder.onstop = null;
    session.recorder.onerror = null;
    if (session.recorder.state !== "inactive") {
      try {
        session.recorder.stop();
      } catch {
        // Tracks are already released, including when the browser stopped first.
      }
    }
  }
}

export default function VoiceComparison() {
  const id = useId();
  const [recordings, setRecordings] = useState({ reference: null, test: null });
  const [capture, setCapture] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [progress, setProgress] = useState("Record or upload both voices to compare.");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const recordingsRef = useRef({ reference: null, test: null });
  const sessionRef = useRef(null);
  const clientRef = useRef(null);
  const mountedRef = useRef(false);
  const comparingRef = useRef(false);
  const comparisonVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      comparisonVersionRef.current += 1;
      discardSession(sessionRef.current);
      sessionRef.current = null;
      clientRef.current?.dispose();
      clientRef.current = null;
      Object.values(recordingsRef.current).forEach((recording) => {
        if (recording) URL.revokeObjectURL(recording.url);
      });
    };
  }, []);

  const replaceRecording = (slot, blob) => {
    const previous = recordingsRef.current[slot];
    const next = blob ? { blob, url: URL.createObjectURL(blob) } : null;
    if (previous) URL.revokeObjectURL(previous.url);
    recordingsRef.current = { ...recordingsRef.current, [slot]: next };
    setRecordings(recordingsRef.current);
    comparisonVersionRef.current += 1;
    setResult(null);
  };

  const stopRecording = (session = sessionRef.current) => {
    if (!session || session.stopping) return;
    if (!session.recorder) {
      discardSession(session);
      if (sessionRef.current === session) sessionRef.current = null;
      setCapture(null);
      setProgress("Microphone request cancelled.");
      return;
    }
    session.stopping = true;
    setCapture({ slot: session.slot, phase: "stopping" });
    clearTimeout(session.timer);
    try {
      session.recorder.stop();
      releaseMicrophone(session);
    } catch {
      discardSession(session);
      sessionRef.current = null;
      setCapture(null);
      setError("Unable to finish this recording. Please record it again.");
    }
  };

  const startRecording = async (slot) => {
    if (sessionRef.current || comparingRef.current) return;
    setError("");
    setResult(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is unavailable. Use HTTPS or localhost in a supported browser, or upload an audio file.");
      return;
    }

    const session = { slot, chunks: [], cancelled: false, stopping: false };
    sessionRef.current = session;
    setCapture({ slot, phase: "requesting" });
    setProgress("Waiting for microphone permission...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      session.stream = stream;
      if (session.cancelled || !mountedRef.current || sessionRef.current !== session) {
        releaseMicrophone(session);
        return;
      }

      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      session.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) session.chunks.push(event.data);
      };
      recorder.onstop = () => {
        releaseMicrophone(session);
        if (session.cancelled || !mountedRef.current || sessionRef.current !== session) return;
        sessionRef.current = null;
        setCapture(null);
        const blob = new Blob(session.chunks, { type: recorder.mimeType || session.chunks[0]?.type || "audio/webm" });
        if (!blob.size) {
          setError("No audio was captured. Please check your microphone and record again.");
          return;
        }
        replaceRecording(slot, blob);
        setProgress(`${slot === "reference" ? "Reference" : "Test"} recording ready.`);
      };
      recorder.onerror = () => {
        discardSession(session);
        if (!mountedRef.current || sessionRef.current !== session) return;
        sessionRef.current = null;
        setCapture(null);
        setError("Microphone recording failed. Please check your microphone and try again.");
      };
      recorder.start();
      replaceRecording(slot, null);
      setCapture({ slot, phase: "recording" });
      setProgress(`Recording ${slot} voice. Speak clearly, then press Stop recording.`);
      session.timer = setTimeout(() => stopRecording(session), CAPTURE_SECONDS * 1000);
    } catch (captureError) {
      discardSession(session);
      if (session.cancelled && sessionRef.current !== session) return;
      if (!mountedRef.current || sessionRef.current !== session) return;
      sessionRef.current = null;
      setCapture(null);
      setError(captureError?.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access, or upload an audio file."
        : "Unable to access the microphone. Check that it is connected and try again, or upload an audio file.");
      setProgress("Recording could not start.");
    }
  };

  const uploadRecording = (slot, event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || sessionRef.current || comparingRef.current) return;
    setError("");
    if (!file.size || file.size > MAX_AUDIO_BYTES) {
      setError("Choose a non-empty audio file up to 20 MB.");
      return;
    }
    replaceRecording(slot, file);
    setProgress(`${slot === "reference" ? "Reference" : "Test"} audio ready. The browser will check the audio when you compare.`);
  };

  const compareVoices = async () => {
    const { reference, test } = recordingsRef.current;
    if (!reference || !test || sessionRef.current || comparingRef.current) return;
    comparingRef.current = true;
    const version = ++comparisonVersionRef.current;
    setIsComparing(true);
    setError("");
    setResult(null);
    setProgress("Preparing recordings...");
    try {
      clientRef.current ??= createVoiceComparisonClient();
      const score = await clientRef.current.compare(reference.blob, test.blob, (message) => {
        if (mountedRef.current && comparisonVersionRef.current === version) setProgress(message);
      });
      if (!mountedRef.current || comparisonVersionRef.current !== version) return;
      if (!Number.isFinite(score) || score < -1 || score > 1) throw new Error("Invalid voice score");
      setResult(score);
      setProgress("Comparison complete.");
    } catch (comparisonError) {
      if (!mountedRef.current || comparisonVersionRef.current !== version) return;
      setError(getVoiceErrorMessage(comparisonError));
      setProgress("Comparison failed. You can try again.");
    } finally {
      if (mountedRef.current && comparisonVersionRef.current === version) {
        comparingRef.current = false;
        setIsComparing(false);
      }
    }
  };

  const cancelComparison = () => {
    comparisonVersionRef.current += 1;
    comparingRef.current = false;
    clientRef.current?.dispose();
    clientRef.current = null;
    setIsComparing(false);
    setError("");
    setProgress("Comparison cancelled. Your recordings are ready to compare again.");
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-700 dark:bg-indigo-900/20">
      <h2 id={`${id}-heading`} className="text-base font-semibold">Voice Comparison</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Record or upload two clips of clear speech from one speaker each. Aim for 5–10 seconds per clip. Recording stops automatically after 10 seconds; uploaded clips must be 3–15 seconds long.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {slots.map(({ key, title, description }) => {
          const isActive = capture?.slot === key;
          return (
            <article key={key} aria-labelledby={`${id}-${key}`} className="rounded-xl border border-indigo-200 bg-white p-4 dark:border-indigo-700 dark:bg-slate-900/50">
              <h3 id={`${id}-${key}`} className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {isActive ? (
                  <button type="button" className={buttonClasses} onClick={() => stopRecording()} disabled={capture.phase === "stopping"}>
                    {capture.phase === "requesting" ? "Cancel microphone request" : "Stop recording"}
                  </button>
                ) : (
                  <button type="button" className={buttonClasses} onClick={() => startRecording(key)} disabled={Boolean(capture) || isComparing}>
                    {recordings[key] ? "Re-record" : "Record"} {key} voice
                  </button>
                )}
                <label className={`${secondaryButtonClasses} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-500 ${capture || isComparing ? "cursor-not-allowed opacity-60" : ""}`}>
                  Upload audio
                  <input type="file" accept="audio/*" aria-label={`Upload ${key} voice`} className="sr-only" disabled={Boolean(capture) || isComparing} onChange={(event) => uploadRecording(key, event)} />
                </label>
                {recordings[key] && (
                  <button type="button" className={secondaryButtonClasses} aria-label={`Clear ${key} voice`} disabled={Boolean(capture) || isComparing} onClick={() => { replaceRecording(key, null); setError(""); setProgress("Record or upload both voices to compare."); }}>
                    Clear
                  </button>
                )}
              </div>
              {recordings[key] ? (
                <audio controls preload="metadata" src={recordings[key].url} aria-label={`${title} playback`} className="mt-3 w-full" />
              ) : (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{isActive ? (capture.phase === "requesting" ? "Waiting for microphone access..." : capture.phase === "stopping" ? "Finishing recording..." : "Recording...") : "No recording yet."}</p>
              )}
            </article>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClasses} onClick={compareVoices} disabled={!recordings.reference || !recordings.test || Boolean(capture) || isComparing}>
          {isComparing ? "Comparing voices..." : "Compare Voices"}
        </button>
        {isComparing && <button type="button" className={secondaryButtonClasses} onClick={cancelComparison}>Cancel comparison</button>}
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{progress}</p>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {result !== null && (
        <div aria-live="polite" className="mt-4 rounded-xl border border-indigo-200 bg-white p-4 dark:border-indigo-700 dark:bg-slate-900/50">
          <h3 className="font-semibold">Voice similarity</h3>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{result.toFixed(3)}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Cosine similarity ranges from −1 to 1; higher values mean the recordings sound more alike to the model. This is not a probability or proof of identity.</p>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Recordings stay in this browser&apos;s memory and are not uploaded or saved. The first comparison downloads a speaker model (about 42 MB) and its runtime. Noise, microphones, and voice changes can affect the result. Audio files must be supported by your browser and no larger than 20 MB.
      </p>
    </section>
  );
}
