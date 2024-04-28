import React, { useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as facemesh from '@tensorflow-models/facemesh';

const FaceRecognition = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameId = useRef();

  const setupCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }); // Specify desired dimensions or remove to use defaults
    videoRef.current.srcObject = stream;
    videoRef.current.addEventListener('loadedmetadata', () => {
      videoRef.current.play();
      // Set canvas dimensions to match video after video metadata has loaded
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
      
      console.log(predictions);
      drawMesh(predictions);
    }
    animationFrameId.current = requestAnimationFrame(() => detectFaces(model));
  };

  const drawMesh = async (predictions) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    await Promise.all(predictions.map(async (prediction) => {
      const keypoints = await prediction.scaledMesh.data();
      const points = [];

      for (let i = 0; i < keypoints.length; i += 3) {
        points.push([keypoints[i], keypoints[i + 1]]);
      }

      ctx.fillStyle = "aqua";
      points.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, 2 * Math.PI);
        ctx.fill();
      });
    }));
  };

  useEffect(() => {
    setupCamera();
    loadModel();

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  return (
    <div>
      <video ref={videoRef} width="640" height="480" autoPlay muted style={{ position: 'absolute' }} />
      <canvas ref={canvasRef} style={{ position: 'absolute' }} />
    </div>
  );
};

export default FaceRecognition;