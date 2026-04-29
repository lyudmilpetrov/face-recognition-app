import "./App.css";
import React, { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import Navbar from "./Components/NavBar";
import { setTheme } from "./slice/main-slice";
import { useDispatch, useSelector } from "react-redux";
import FaceRecognitionBlaze from "./Components/FaceRecognitionBlaze";

function App() {
  const dispatch = useDispatch();
  const { theme } = useSelector((state) => state.main);
  const faceRecognitionRef1 = useRef();
  const faceRecognitionRef2 = useRef();
  const speechRecognitionRef = useRef(null);

  const [stopped1, setStopped1] = useState(true);
  const [stopped2, setStopped2] = useState(true);
  const [info1, setInfo1] = useState(null);
  const [info2, setInfo2] = useState(null);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);

  const handleStop = (ref, stopped, setStopped, setInfo) => {
    if (ref.current) {
      if (!stopped) {
        const info = ref.current.stopFaceRecognition();
        setInfo(info);
        setStopped(true);
      } else {
        ref.current.startFaceRecognition();
        setStopped(false);
      }
    }
  };

  const handleThemeChange = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    dispatch(setTheme(newTheme));
  };

  const compareFaces = async () => {
    if (!info1 || !info2) {
      toast.error(
        "Finish both detections first, then press Stop Recognition on each video to capture results."
      );
      return;
    }
    const matchPercentage = await toast.promise(
      Promise.resolve(comparePredictionsBlaze(info1, info2)),
      {
        loading: "Comparing face frames...",
        success: "Comparison complete.",
        error: "Comparison failed. Please try again.",
      }
    );
    const roundedMatch = Number(matchPercentage).toFixed(1);
    const message =
      matchPercentage >= 80
        ? `Strong match: ${roundedMatch}% similarity.`
        : `Low match: ${roundedMatch}% similarity.`;
    toast(message, {
      icon: matchPercentage >= 80 ? "✅" : "ℹ️",
    });
  };

  const comparePredictionsBlaze = (pred1, pred2) => {
    if (!pred1?.length || !pred2?.length) return 0;

    const normalizeBox = (box) => {
      const width = box.bottomRight[0] - box.topLeft[0];
      const height = box.bottomRight[1] - box.topLeft[1];
      const centerX = box.topLeft[0] + width / 2;
      const centerY = box.topLeft[1] + height / 2;
      return { width, height, centerX, centerY };
    };

    const box1 = normalizeBox(pred1[0]);
    const box2 = normalizeBox(pred2[0]);

    const widthSimilarity = Math.min(
      box1.width / box2.width,
      box2.width / box1.width
    );
    const heightSimilarity = Math.min(
      box1.height / box2.height,
      box2.height / box1.height
    );
    const sizeSimilarity = widthSimilarity * heightSimilarity;

    const distanceX = Math.abs(box1.centerX - box2.centerX);
    const distanceY = Math.abs(box1.centerY - box2.centerY);
    const maxDistance = Math.sqrt(
      Math.pow(Math.max(box1.width, box2.width), 2) +
        Math.pow(Math.max(box1.height, box2.height), 2)
    );
    const positionSimilarity =
      1 -
      Math.sqrt(Math.pow(distanceX, 2) + Math.pow(distanceY, 2)) / maxDistance;

    const overallSimilarity = sizeSimilarity * positionSimilarity * 100;
    if (overallSimilarity < 80) return 0;
    return overallSimilarity;
  };

  useEffect(() => {
    const startRecognition = async (ref, setStopped) => {
      if (!ref.current) {
        return;
      }
      try {
        await ref.current.startFaceRecognition();
        setStopped(false);
      } catch (error) {
        toast.error("Unable to access the camera. Please allow permissions.");
      }
    };

    startRecognition(faceRecognitionRef1, setStopped1);
    startRecognition(faceRecognitionRef2, setStopped2);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  const setupSpeechRecognition = () => {
    if (typeof window === "undefined") {
      return null;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setVoiceTranscript(transcript.trim());
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    return recognition;
  };

  const startVoiceCapture = () => {
    if (isListening) {
      return;
    }

    if (!speechRecognitionRef.current) {
      speechRecognitionRef.current = setupSpeechRecognition();
    }

    if (!speechRecognitionRef.current) {
      toast.error("Voice capture is not supported in this browser.");
      return;
    }

    speechRecognitionRef.current.start();
    setIsListening(true);
  };

  const stopVoiceCapture = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
    }
  };

  const buttonClasses =
    "inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-indigo-500/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400";

  const panelClasses =
    "relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm shadow-slate-200/70 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/60 dark:shadow-none";

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <Toaster position="top-right" />
      <Navbar
        title="Face Recognitions Demos"
        handleThemeChange={handleThemeChange}
        theme={theme}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 sm:gap-6 sm:px-6">
        <section className="flex flex-col items-center gap-3 text-center">
          <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <p>
              Mobile-first face comparison with live camera detection and a quick
              voice capture panel for multimodal experimentation.
            </p>
          </div>
          <button className={`${buttonClasses} w-full sm:w-auto`} onClick={compareFaces}>
            Compare Faces
          </button>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <article className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-700 dark:bg-slate-800/40">
            <button
              className={`${buttonClasses} w-full sm:w-auto`}
              onClick={() =>
                handleStop(faceRecognitionRef1, stopped1, setStopped1, setInfo1)
              }
            >
              {!stopped1 ? "Stop" : "Start"} Recognition 1
            </button>
            <div className={panelClasses}>
              <FaceRecognitionBlaze
                ref={faceRecognitionRef1}
                videoId="video1"
                canvasId="canvas1"
                frameColor="aqua"
                setInfo={setInfo1}
              />
            </div>
          </article>

          <article className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-700 dark:bg-slate-800/40">
            <button
              className={`${buttonClasses} w-full sm:w-auto`}
              onClick={() =>
                handleStop(faceRecognitionRef2, stopped2, setStopped2, setInfo2)
              }
            >
              {!stopped2 ? "Stop" : "Start"} Recognition 2
            </button>
            <div className={panelClasses}>
              <FaceRecognitionBlaze
                ref={faceRecognitionRef2}
                videoId="video2"
                canvasId="canvas2"
                frameColor="red"
                setInfo={setInfo2}
              />
            </div>
          </article>
        </section>

        <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-700 dark:bg-indigo-900/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold">Voice Capture</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                className={`${buttonClasses} w-full sm:w-auto`}
                onClick={startVoiceCapture}
                disabled={isListening}
              >
                Start Voice Capture
              </button>
              <button className={`${buttonClasses} w-full sm:w-auto`} onClick={stopVoiceCapture}>
                Stop Voice Capture
              </button>
            </div>
          </div>
          <p className="mt-3 min-h-16 rounded-xl border border-indigo-200 bg-white p-3 text-sm text-slate-700 dark:border-indigo-700 dark:bg-slate-900/40 dark:text-slate-200">
            {voiceTranscript || "Your live transcript will appear here."}
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Status: {isListening ? "Listening..." : "Idle"}
          </p>
        </section>
      </main>
    </div>
  );
}

export default App;
