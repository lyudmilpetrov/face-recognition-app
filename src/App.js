import "./App.css";
import React, { useRef, useState } from "react";
import FaceRecognitionBlaze from "./Components/FaceRecognitionBlaze";
import Navbar from "./Components/NavBar";
import { setTheme, setErrors } from "./slice/main-slice";
import { useDispatch, useSelector } from "react-redux";
import FaceRecognitionMesh from "./Components/FaceRecognitionMesh";

function App() {
  const dispatch = useDispatch();
  const { theme } = useSelector((state) => state.main);
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
        console.log(info);
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

  const handleThemeChange = (event) => {
    const newTheme = theme === "light" ? "dark" : "light";
    dispatch(setTheme(newTheme));
    event.stopPropagation();
    event.preventDefault();
  };

  const compareFaces = () => {
    if (!info1 || !info2) {
      alert(
        "Both detections must be completed before comparing. Please press stop recognition button to get the detection results."
      );
      return;
    }
    // Dummy comparison logic: compares size of bounding boxes
    const matchPercentage = comparePredictions(info1, info2);
    alert(`The faces are ${matchPercentage}% likely to be the same person.`);
  };

  const comparePredictions = (pred1, pred2) => {
    if (pred1.length === 0 || pred2.length === 0) return 0;

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
    const overallSimilarity = (
      sizeSimilarity *
      positionSimilarity *
      100
    ).toFixed(2);
    if (overallSimilarity < 80) return 0;
    return overallSimilarity;
  };

  const mainClasses =
    theme === "light" ? "bg-gray-100 text-black" : "bg-gray-600 text-white";
  const buttonClasses =
    theme === "light"
      ? "bg-blue-500 hover:bg-blue-700"
      : "bg-blue-900 hover:bg-blue-800";

  return (
    <>
      <div className={`${mainClasses} flex flex-col min-h-screen`}>
        <Navbar
          title="Face Recognitions Demos"
          handleThemeChange={handleThemeChange}
          theme={theme}
        />
        <div className="flex flex-col items-center m-1">
          <button
            className={`px-4 py-2 rounded ${buttonClasses} text-white`}
            onClick={compareFaces}
          >
            Compare Faces
          </button>
        </div>
        <div className="flex-grow flex flex-row justify-center items-stretch">
          <div className="flex flex-col justify-center items-center w-1/2">
            <div className="flex m-2">
              <button
                className={`px-4 py-2 rounded ${buttonClasses} text-white`}
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
                className={`px-4 py-2 ml-2 rounded ${buttonClasses} text-white`}
                onClick={() => handleDownloadImage(faceRecognitionRef1)}
              >
                Download Image 1
              </button>
            </div>
            <div
              style={{ position: "relative", width: "100%", height: "100%" }}
            >
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
          <div className="flex flex-col justify-center items-center w-1/2">
            <div className="flex m-2">
              <button
                className={`px-4 py-2 rounded ${buttonClasses} text-white`}
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
                className={`px-4 py-2 ml-2 rounded ${buttonClasses} text-white`}
                onClick={() => handleDownloadImage(faceRecognitionRef2)}
              >
                Download Image 2
              </button>
            </div>
            <div
              style={{ position: "relative", width: "100%", height: "100%" }}
              className=""
            >
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
