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
  const [stopped1, setStopped1] = useState(true);
  const [stopped2, setStopped2] = useState(true);
  const [info1, setInfo1] = useState(null);
  const [info2, setInfo2] = useState(null);

  const handleStop = (ref, stopped, setStopped, setInfo) => {
    if (ref.current) {
      if (!stopped) {
        const info = ref.current.stopFaceRecognition();
        console.log(info);
        console.log(JSON.stringify(info));
        setInfo(info);
        setStopped(true);
      } else {
        ref.current.startFaceRecognition();
        setStopped(false);
      }
    }
  };

  const receivePedictions = (predictions, source) => {
    // console.log(predictions, source);
    if (source === "video1") {
      if (predictions.length > 0) {
        // setInfo1(predictions);
      }
    } else {
      if (predictions.length > 0) {
        // setInfo2(predictions);
      }
    }
  };

  const handleDownloadImage = (ref) => {
    if (ref.current) {
      ref.current.downloadImage();
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

    // Normalize bounding box sizes by the width and height of the boxes
    const normalizeBox = (box) => {
      const width = box.bottomRight[0] - box.topLeft[0];
      const height = box.bottomRight[1] - box.topLeft[1];
      const centerX = box.topLeft[0] + width / 2;
      const centerY = box.topLeft[1] + height / 2;
      return { width, height, centerX, centerY };
    };

    const box1 = normalizeBox(pred1[0]);
    const box2 = normalizeBox(pred2[0]);

    // Calculate size similarity
    const widthSimilarity = Math.min(
      box1.width / box2.width,
      box2.width / box1.width
    );
    const heightSimilarity = Math.min(
      box1.height / box2.height,
      box2.height / box1.height
    );
    const sizeSimilarity = widthSimilarity * heightSimilarity;

    // Calculate position similarity based on the distance between centers
    const distanceX = Math.abs(box1.centerX - box2.centerX);
    const distanceY = Math.abs(box1.centerY - box2.centerY);
    const maxDistance = Math.sqrt(
      Math.pow(Math.max(box1.width, box2.width), 2) +
        Math.pow(Math.max(box1.height, box2.height), 2)
    );
    const positionSimilarity =
      1 -
      Math.sqrt(Math.pow(distanceX, 2) + Math.pow(distanceY, 2)) / maxDistance;

    // Combine size and position similarities
    const overallSimilarity = sizeSimilarity * positionSimilarity * 100;
    if (overallSimilarity < 80) return 0;
    return overallSimilarity;
  };

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  const buttonClasses =
    "inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-indigo-500/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400";

  const panelClasses =
    "relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm shadow-slate-200/70 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/60 dark:shadow-none";

  return (
    <>
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
        <Toaster position="top-right" />
        <Navbar
          title="Face Recognitions Demos"
          handleThemeChange={handleThemeChange}
          theme={theme}
        />
        <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
          <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <p>
              This app is a playground for experimenting with TensorFlow-based
              face recognition, showing how live video streams are analyzed and
              translated into detection data in real time.
            </p>
            <p>
              It is intentionally set up for rapid iteration, with the idea of
              expanding beyond faces into voice recognition and other biometric
              signals as the next step.
            </p>
          </div>
          <button
            className={buttonClasses}
            onClick={compareFaces}
          >
            Compare Faces
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-6 px-4 pb-8 lg:flex-row">
          <div className="flex w-full flex-col items-center gap-4 lg:w-1/2">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                className={`${buttonClasses} w-full sm:w-auto`}
                onClick={() =>
                  handleStop(
                    faceRecognitionRef1,
                    stopped1,
                    setStopped1,
                    setInfo1
                  )
                }
              >
                {!stopped1 ? "Stop" : "Start"} Recognition 1
              </button>
              <button
                className={`${buttonClasses} w-full sm:w-auto`}
                onClick={() => handleDownloadImage(faceRecognitionRef1)}
              >
                Download Image 1
              </button>
            </div>
            <div className={panelClasses}>
              <FaceRecognitionBlaze
                ref={faceRecognitionRef1}
                videoId="video1" // Ensure these are unique
                canvasId="canvas1"
                frameColor="aqua"
                receivePedictions={receivePedictions}
                setInfo={setInfo1}
              />
            </div>
          </div>
          <div className="flex w-full flex-col items-center gap-4 lg:w-1/2">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                className={`${buttonClasses} w-full sm:w-auto`}
                onClick={() =>
                  handleStop(
                    faceRecognitionRef2,
                    stopped2,
                    setStopped2,
                    setInfo2
                  )
                }
              >
                {!stopped2 ? "Stop" : "Start"} Recognition 2
              </button>
              <button
                className={`${buttonClasses} w-full sm:w-auto`}
                onClick={() => handleDownloadImage(faceRecognitionRef2)}
              >
                Download Image 2
              </button>
            </div>
            <div className={panelClasses}>
              <FaceRecognitionBlaze
                ref={faceRecognitionRef2}
                videoId="video2" // Ensure these are unique
                canvasId="canvas2"
                frameColor="red"
                receivePedictions={receivePedictions}
                setInfo={setInfo2}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
