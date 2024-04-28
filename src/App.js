import logo from "./logo.svg";
import "./App.css";
import React, { useRef, useState } from "react";
import FaceRecognitionMesh from "./Components/FaceRecognitionMesh";
import FaceRecognitionBlaze from "./Components/FaceRecognitionBlaze";
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
  const handleDownloadImage = () => {
    if (faceRecognitionRef.current) {
      faceRecognitionRef.current.downloadImage();
    }
  };
  return (
    <>
      <button onClick={handleStop}>
        {!stopped ? "Stop" : "Start"} Recognition
      </button>
      <button onClick={handleDownloadImage}>Download Image</button>
      <br />
      {/* <FaceRecognitionMesh
        ref={faceRecognitionRef}
        videoId="video"
        canvasId="canvas"
        width={640}
        height={480}
        meshColor="aqua"
      /> */}
      <FaceRecognitionBlaze
        ref={faceRecognitionRef}
        videoId="video"
        canvasId="canvas"
        width={640}
        height={480}
        frameColor="aqua"
      />
    </>
  );
}

export default App;
