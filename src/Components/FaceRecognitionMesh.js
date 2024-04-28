import React, {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as tf from "@tensorflow/tfjs";
import * as facemesh from "@tensorflow-models/facemesh";
// Mesh gives more detailed information but it is slower
const FaceRecognitionMesh = forwardRef(
  ({ videoId, canvasId, onFacesDetected, width, height, meshColor }, ref) => {
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
      const model = await facemesh.load();
      detectFaces(model);
    };

    const detectFaces = async (model) => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        const video = videoRef.current;
        const predictions = await model.estimateFaces(video, true);
        setCurrentPredictions(predictions);
        if (onFacesDetected) {
          onFacesDetected(predictions);
        }
        drawMesh(predictions);
      }
      animationFrameId.current = requestAnimationFrame(() =>
        detectFaces(model)
      );
    };

    // const drawMesh = async (predictions) => {
    //   const ctx = canvasRef.current.getContext("2d");
    //   ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    //   predictions.forEach(async (prediction) => {
    //     const keypoints = await prediction.scaledMesh.data();
    //     const points = [];
    //     for (let i = 0; i < keypoints.length; i += 3) {
    //       points.push([keypoints[i], keypoints[i + 1]]);
    //     }
    //     ctx.fillStyle = meshColor;
    //     points.forEach(([x, y]) => {
    //       ctx.beginPath();
    //       ctx.arc(x, y, 1, 0, 2 * Math.PI);
    //       ctx.fill();
    //     });
    //   });
    // };
    const drawMesh = async (predictions) => {
      const ctx = canvasRef.current.getContext("2d");
      // Clear the canvas
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Draw the video frame onto the canvas
      if (videoRef.current) {
        ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    
      // Draw the mesh
      predictions.forEach(async (prediction) => {
        const keypoints = await prediction.scaledMesh.data();
        const points = [];
        for (let i = 0; i < keypoints.length; i += 3) {
          points.push([keypoints[i], keypoints[i + 1]]);
        }
        ctx.fillStyle = meshColor;
        points.forEach(([x, y]) => {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, 2 * Math.PI);
          ctx.fill();
        });
      });
    };
    
    const stopFaceRecognition = () => {
      if (videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach((track) => track.stop());
      }
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      return currentPredictions;
    };

    const startFaceRecognition = async () => {
      // Restart the recognition process
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
  }
);

export default FaceRecognitionMesh;
