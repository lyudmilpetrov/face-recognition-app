import "./App.css";
import React, { useRef, useState } from "react";
import FaceRecognitionBlaze from "./Components/FaceRecognitionBlaze";

function App() {
  const faceRecognitionRef1 = useRef();
  const faceRecognitionRef2 = useRef();
  const [stopped1, setStopped1] = useState(false);
  const [stopped2, setStopped2] = useState(false);
  const [info1, setInfo1] = useState(null);
  const [info2, setInfo2] = useState(null);

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

  const handleDownloadImage = (ref) => {
    if (ref.current) {
      ref.current.downloadImage();
    }
  };

  const compareFaces = () => {
    if (!info1 || !info2) {
      alert("Both detections must be completed before comparing.");
      return;
    }

    // Dummy comparison logic: compares size of bounding boxes
    const matchPercentage = comparePredictions(info1, info2);
    alert(`The faces are ${matchPercentage}% likely to be the same person.`);
  };

  const comparePredictions = (pred1, pred2) => {
    // Simplistic comparison: Check if bounding box sizes are similar
    if (pred1.length === 0 || pred2.length === 0) return 0;
    const box1 = pred1[0].bottomRight.map(
      (v, idx) => v - pred1[0].topLeft[idx]
    );
    const box2 = pred2[0].bottomRight.map(
      (v, idx) => v - pred2[0].topLeft[idx]
    );

    const sizeSimilarity =
      Math.min(box1[0] / box2[0], box2[0] / box1[0]) *
      Math.min(box1[1] / box2[1], box2[1] / box1[1]);
    return (sizeSimilarity * 100).toFixed(2);
  };

  return (
    <div className="mx-auto mt-5 space-y-8">
      <div className="flex flex-col items-center m-10">
        <button
          className="px-4 py-2 rounded bg-orange-500"
          onClick={compareFaces}
        >
          Compare Faces
        </button>
      </div>
      <div className="flex flex-col items-center m-10">
        <div className="mt-8 p-4 shadow-lg rounded bg-white">
          <button
            className={`px-4 py-2 rounded ${
              stopped1 ? "bg-red-500" : "bg-blue-500"
            } text-white`}
            onClick={() =>
              handleStop(faceRecognitionRef1, stopped1, setStopped1, setInfo1)
            }
          >
            {!stopped1 ? "Stop" : "Start"} Recognition 1
          </button>
          <button
            className="px-4 py-2 ml-2 rounded bg-green-500 text-white"
            onClick={() => handleDownloadImage(faceRecognitionRef1)}
          >
            Download Image 1
          </button>
          <FaceRecognitionBlaze
            ref={faceRecognitionRef1}
            videoId="video1"
            canvasId="canvas1"
            width={640}
            height={480}
            frameColor="aqua"
          />
        </div>
      </div>
      <div className="flex flex-col items-center m-10">
        <div className="mt-8 p-4 shadow-lg rounded bg-white">
          <button
            className={`px-4 py-2 rounded ${
              stopped2 ? "bg-red-500" : "bg-blue-500"
            } text-white`}
            onClick={() =>
              handleStop(faceRecognitionRef2, stopped2, setStopped2, setInfo2)
            }
          >
            {!stopped2 ? "Stop" : "Start"} Recognition 2
          </button>
          <button
            className="px-4 py-2 ml-2 rounded bg-green-500 text-white"
            onClick={() => handleDownloadImage(faceRecognitionRef2)}
          >
            Download Image 2
          </button>
          <FaceRecognitionBlaze
            ref={faceRecognitionRef2}
            videoId="video2"
            canvasId="canvas2"
            width={640}
            height={480}
            frameColor="red"
          />
        </div>
      </div>
    </div>
  );
}
export default App;
