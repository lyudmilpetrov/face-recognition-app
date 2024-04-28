import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import * as tf from "@tensorflow/tfjs";
import * as blazeface from "@tensorflow-models/blazeface";

const FaceRecognitionBlaze = forwardRef(({
  videoId,
  canvasId,
  onFacesDetected,
  width,
  height,
  frameColor
}, ref) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameId = useRef();
  const [currentPredictions, setCurrentPredictions] = useState(null);

  useImperativeHandle(ref, () => ({
    stopFaceRecognition,
    downloadImage,
    startFaceRecognition,
  }));

  const setupCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width, height },
    });
    videoRef.current.srcObject = stream;
    videoRef.current.addEventListener("loadedmetadata", () => {
      videoRef.current.play();
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
    });
  };

  const loadModel = async () => {
    const model = await blazeface.load();
    detectFaces(model);
  };

  const detectFaces = async (model) => {
    if (videoRef.current && videoRef.current.readyState >= 2) {
      const video = videoRef.current;
      const predictions = await model.estimateFaces(video);
      setCurrentPredictions(predictions);
      if (onFacesDetected) {
        onFacesDetected(predictions);
      }
      drawFrame(predictions);
    }
    animationFrameId.current = requestAnimationFrame(() => detectFaces(model));
  };

  const drawFrame = (predictions) => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    // Draw the video frame onto the canvas
    ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);

    // Draw the bounding boxes
    predictions.forEach(prediction => {
      const [x, y, width, height] = prediction.topLeft.concat(prediction.bottomRight);
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width - x, height - y);
    });
  };

  const stopFaceRecognition = () => {
    if (videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
    return currentPredictions;
  };

  const startFaceRecognition = async () => {
    await setupCamera();
    await loadModel();
  };

  const downloadImage = () => {
    const canvas = canvasRef.current;
    const image = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = "face_recognition_image.png";
    link.href = image;
    link.click();
  };

  useEffect(() => {
    setupCamera();
    loadModel();

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      stopFaceRecognition();
    };
  }, []);

  return (
    <div>
      <video
        ref={videoRef}
        id={videoId}
        width={width}
        height={height}
        autoPlay
        muted
        style={{ position: "absolute" }}
      />
      <canvas
        ref={canvasRef}
        id={canvasId}
        width={width}
        height={height}
        style={{ position: "absolute" }}
      />
    </div>
  );
});

export default FaceRecognitionBlaze;