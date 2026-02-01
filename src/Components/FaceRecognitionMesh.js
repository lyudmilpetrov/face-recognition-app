import React, {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as tf from "@tensorflow/tfjs";
import * as faceLandmarksDetection from "@tensorflow-models/face-landmarks-detection";
// Mesh gives more detailed information but it is slower
const FaceRecognitionMesh = forwardRef(
  (
    {
      videoId,
      canvasId,
      onFacesDetected,
      meshColor,
      receivePedictions,
      setInfo,
    },
    ref
  ) => {
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
        video: { facingMode: "user" },
      });
      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener("loadedmetadata", () => {
        videoRef.current.play();
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
      });
    };

    const loadModel = async () => {
      const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
      const detector = await faceLandmarksDetection.createDetector(model, {
        runtime: "tfjs",
      });
      detectFaces(detector);
    };

    const detectFaces = async (detector) => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        const video = videoRef.current;
        const predictions = await detector.estimateFaces(video, {
          flipHorizontal: true,
        });
        setCurrentPredictions(predictions);
        if (onFacesDetected) {
          onFacesDetected(predictions);
        }
        drawMesh(predictions);
        // console.log(predictions);
        // receivePedictions(predictions,videoId);
        // setInfo(predictions);
      }
      animationFrameId.current = requestAnimationFrame(() =>
        detectFaces(detector)
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
        ctx.drawImage(
          videoRef.current,
          0,
          0,
          canvasRef.current.width,
          canvasRef.current.height
        );
      }

      // Draw the mesh
      predictions.forEach((prediction) => {
        const points = prediction.keypoints.map(({ x, y }) => [x, y]);
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
      <>
        <video
          ref={videoRef}
          id={videoId}
          autoPlay
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        <canvas
          ref={canvasRef}
          id={canvasId}
          className="absolute inset-0 h-full w-full"
        />
      </>
    );
  }
);

export default FaceRecognitionMesh;
