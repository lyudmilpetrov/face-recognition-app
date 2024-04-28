import logo from "./logo.svg";
import "./App.css";
import React, { useRef, useState } from "react";
import FaceRecognition from "./Components/FaceRecognition";
function App() {
  const faceRecognitionRef = useRef();
  const [stopped, setStopped] = useState(false);
  const [info, setInfo] = useState(null); // [predictions, setPredictions
  const handleStop = () => {
    if (faceRecognitionRef.current) {
      if (stopped === false) {
        const info = faceRecognitionRef.current.stopFaceRecognition();
        setInfo(info);
        setStopped(true);
      } else {
        faceRecognitionRef.current.startFaceRecognition();
        setStopped(false);
      }
    }
  };
  return (
    <>
      <button onClick={handleStop}>
        {!stopped ? "Stop" : "Start"} Recognition
      </button>
      <br />
      <FaceRecognition
        ref={faceRecognitionRef}
        videoId="video"
        canvasId="canvas"
        width={640}
        height={480}
        meshColor="aqua"
      />
    </>
  );
}

export default App;
