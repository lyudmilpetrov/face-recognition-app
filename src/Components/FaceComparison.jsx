import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import FaceRecognitionBlaze from "./FaceRecognitionBlaze";
import { compareFaceImages, getFaceComparisonErrorMessage } from "../services/faceComparison";

function FaceComparison() {
  const faceRecognitionRef1 = useRef();
  const faceRecognitionRef2 = useRef();
  const comparisonVersionRef = useRef(0);
  const comparisonPendingRef = useRef(false);
  const mountedRef = useRef(true);

  const [stopped1, setStopped1] = useState(true);
  const [stopped2, setStopped2] = useState(true);
  const [info1, setInfo1] = useState(null);
  const [info2, setInfo2] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);

  const invalidateComparison = () => {
    // Async model work belongs only to the stills selected when it started.
    comparisonVersionRef.current += 1;
    setComparisonResult(null);
  };

  const handleStop = async (ref, stopped, setStopped, setInfo) => {
    if (ref.current) {
      invalidateComparison();
      if (!stopped) {
        // Snapshot clean camera pixels before releasing the stream. Recognition
        // detects and aligns faces in this exact still, without overlay boxes.
        const image = ref.current.captureFrame();
        ref.current.stopFaceRecognition();
        setInfo(image);
        setStopped(true);
        if (!image) {
          toast.error("The camera frame is not ready. Start recognition and try capturing again.");
        }
      } else {
        // A new run must produce a new stopped result before it can be compared.
        setInfo(null);
        setStopped(false);
        try {
          await ref.current.startFaceRecognition();
        } catch {
          setStopped(true);
          console.log("[FaceComparison] Camera restart failed; capture a new frame before comparing.");
          toast.error("Unable to start face detection. Please check camera permissions and try again.");
        }
      }
    }
  };

  const handleRecognitionError = (setStopped, setInfo) => {
    invalidateComparison();
    setStopped(true);
    setInfo(null);
    toast.error("Face detection stopped. Please start recognition again.");
  };

  const compareFaces = async () => {
    if (comparisonPendingRef.current) {
      return;
    }
    console.log("[FaceComparison] Step 1: Check that both cameras have stopped still images.");
    if (!info1 || !info2 || !stopped1 || !stopped2) {
      console.log("[FaceComparison] Comparison skipped: capture a still from both camera panels first.");
      toast.error(
        "Press Stop Recognition on each camera to capture a still image before comparing."
      );
      return;
    }
    const version = comparisonVersionRef.current;
    comparisonPendingRef.current = true;
    setIsComparing(true);
    setComparisonResult(null);
    try {
      console.log("[FaceComparison] Preparing facial-feature extraction from the two stopped camera images.");
      const result = await compareFaceImages(info1, info2);
      if (!mountedRef.current || comparisonVersionRef.current !== version) {
        console.log("[FaceComparison] Captures changed; ignoring the obsolete comparison result.");
        return;
      }
      setComparisonResult(result);
      console.log("[FaceComparison] Step 6: Display facial-feature distance against the demo threshold.");
    } catch (error) {
      if (mountedRef.current && comparisonVersionRef.current === version) {
        console.log("[FaceComparison] Comparison failed; showing safe instructions for another capture.");
        toast.error(getFaceComparisonErrorMessage(error));
      }
    } finally {
      comparisonPendingRef.current = false;
      if (mountedRef.current) {
        setIsComparing(false);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      comparisonVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const startRecognition = async (ref, setStopped) => {
      if (!ref.current) {
        return;
      }
      // Expose Stop while startup is pending. Completion of a cancelled startup
      // must not change the stopped state chosen by the user in the meantime.
      setStopped(false);
      try {
        await ref.current.startFaceRecognition();
      } catch {
        setStopped(true);
        toast.error("Unable to access the camera. Please allow permissions.");
      }
    };

    startRecognition(faceRecognitionRef1, setStopped1);
    startRecognition(faceRecognitionRef2, setStopped2);
  }, []);

  const buttonClasses =
    "inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs shadow-indigo-500/30 transition hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-indigo-500/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400";

  const panelClasses =
    "relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-xs shadow-slate-200/70 backdrop-blur-xs dark:border-slate-700 dark:bg-slate-800/60 dark:shadow-none";

  return (
    <div className="flex flex-col gap-6">
        <section className="flex flex-col items-center gap-3 text-center">
          <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <p>
              Compare two captures using facial features processed locally in your browser.
            </p>
            <p>
              Stop each camera to capture a still image with one face. Comparison
              aligns the faces and compares learned facial features locally in
              your browser.
            </p>
          </div>
          <button className={`${buttonClasses} w-full sm:w-auto`} onClick={compareFaces} disabled={isComparing}>
            {isComparing ? "Comparing facial features..." : "Compare Faces"}
          </button>
          <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
            {isComparing ? "Detecting faces and comparing facial features..." : comparisonResult && (
              <>
                {comparisonResult.isMatch ? "Similar facial features" : "Different facial features"}.
                {" "}Feature distance: {comparisonResult.distance.toFixed(3)}; threshold: {comparisonResult.threshold.toFixed(3)}.
                {" "}Demo threshold; results can vary with lighting and pose.
              </>
            )}
          </p>
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
                onRecognitionError={() => handleRecognitionError(setStopped1, setInfo1)}
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
                onRecognitionError={() => handleRecognitionError(setStopped2, setInfo2)}
              />
            </div>
          </article>
        </section>

    </div>
  );
}

export default FaceComparison;
