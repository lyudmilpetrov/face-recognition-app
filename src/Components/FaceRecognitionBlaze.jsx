import React, {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-cpu";
import "@tensorflow/tfjs-backend-webgl";
import * as blazeface from "@tensorflow-models/blazeface";

function releaseRecognition(session) {
  session.cancelled = true;
  session.stream?.getTracks().forEach((track) => track.stop());
  session.stream = null;
  session.video.onloadedmetadata = null;
  session.video.srcObject = null;

  if (session.animationFrameId !== null) {
    cancelAnimationFrame(session.animationFrameId);
    session.animationFrameId = null;
  }

  // An in-flight estimate still needs its model until it settles.
  if (!session.estimating) {
    session.model?.dispose();
    session.model = null;
  }
}

const FaceRecognitionBlaze = forwardRef(
  (
    {
      videoId,
      canvasId,
      onFacesDetected,
      frameColor,
    },
    ref
  ) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const sessionRef = useRef(null);
    const predictionsRef = useRef(null);

    const stopFaceRecognition = useCallback(() => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        releaseRecognition(session);
      }
      return predictionsRef.current;
    }, []);

    useImperativeHandle(ref, () => ({
      stopFaceRecognition,
      startFaceRecognition,
    }));

    const setupCamera = async (session, canvas) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      if (session.cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      session.stream = stream;
      const { video } = session;
      video.onloadedmetadata = () => {
        if (!session.cancelled) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
      };
      // The muted video element starts playback through its autoPlay attribute.
      video.srcObject = stream;
    };

    const loadModel = async (session, canvas) => {
      await initializeTensorflow();
      if (session.cancelled) {
        return;
      }
      const model = await blazeface.load();
      if (session.cancelled) {
        model.dispose();
        return;
      }
      session.model = model;
      await detectFaces(session, canvas);
    };

    const initializeTensorflow = async () => {
      try {
        await tf.setBackend("webgl");
      } catch {
        await tf.setBackend("cpu");
      }
      await tf.ready();
    };

    const detectFaces = async (session, canvas) => {
      if (session.cancelled) {
        return;
      }
      const { video } = session;
      if (video.readyState >= 2) {
        let predictions;
        session.estimating = true;
        try {
          predictions = await session.model.estimateFaces(video);
        } catch (error) {
          if (session.cancelled) {
            return;
          }
          throw error;
        } finally {
          session.estimating = false;
          if (session.cancelled) {
            session.model.dispose();
            session.model = null;
          }
        }
        if (session.cancelled) {
          return;
        }
        predictionsRef.current = predictions;
        drawFrame(predictions, video, canvas);
        if (onFacesDetected) {
          onFacesDetected(predictions);
        }
      }
      if (!session.cancelled) {
        session.animationFrameId = requestAnimationFrame(() =>
          detectFaces(session, canvas)
        );
      }
    };

    const drawFrame = (predictions, video, canvas) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw the video frame onto the canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Draw the bounding boxes
      predictions.forEach((prediction) => {
        const [x, y, width, height] = prediction.topLeft.concat(
          prediction.bottomRight
        );
        ctx.strokeStyle = frameColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width - x, height - y);
      });
    };

    const startFaceRecognition = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (sessionRef.current || !video || !canvas) {
        return;
      }

      const session = {
        video,
        stream: null,
        model: null,
        animationFrameId: null,
        cancelled: false,
        estimating: false,
      };
      sessionRef.current = session;
      try {
        await setupCamera(session, canvas);
        if (!session.cancelled) {
          await loadModel(session, canvas);
        }
      } catch (error) {
        if (!session.cancelled) {
          stopFaceRecognition();
          throw error;
        }
      }
    };

    useEffect(() => {
      return stopFaceRecognition;
    }, [stopFaceRecognition]);

    return (
      <>
        <video
          ref={videoRef}
          id={videoId}
          autoPlay
          muted
          className="absolute inset-0 h-full w-full object-contain"
        />
        <canvas
          ref={canvasRef}
          id={canvasId}
          className="absolute inset-0 h-full w-full object-contain"
        />
      </>
    );
  }
);

export default FaceRecognitionBlaze;
