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

// Keep diagnostics to lifecycle/status messages; images and prediction objects
// contain sensitive data and should never be written to the console.
function logCapture(videoId, message) {
  console.log(`[FaceCapture:${videoId}] ${message}`);
}

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
  logCapture(
    session.videoId,
    "8. Cleanup: camera tracks stopped and scheduled detection cancelled; model disposal waits for any active estimate."
  );
}

const FaceRecognitionBlaze = forwardRef(
  (
    {
      videoId,
      canvasId,
      onFacesDetected,
      onRecognitionError,
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
        // Explicit capture is separate so cleanup/unmount never takes a photo.
        // Keep returning detections for existing callers; feature comparison
        // uses the clean pixels returned by captureFrame instead.
        logCapture(
          session.videoId,
          "7. Stop: stopping live detection and keeping the current preview."
        );
        releaseRecognition(session);
      }
      return predictionsRef.current;
    }, []);

    const captureFrame = useCallback(() => {
      const session = sessionRef.current;
      const preview = canvasRef.current;
      const video = session?.video;
      if (
        !session || session.cancelled || !session.stream || !preview ||
        video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0
      ) {
        logCapture(videoId, "7. Capture skipped: wait for a playable camera frame before stopping.");
        return null;
      }

      try {
        // Read directly from the video before stopping its stream. The detached
        // canvas contains no drawn boxes and stays unchanged on a later restart.
        // Its owner keeps it in memory only; no image export or upload occurs.
        const image = document.createElement("canvas");
        image.width = video.videoWidth;
        image.height = video.videoHeight;
        const imageContext = image.getContext("2d");
        const previewContext = preview.getContext("2d");
        if (!imageContext || !previewContext) {
          logCapture(videoId, "7. Capture skipped: a canvas drawing context is unavailable.");
          return null;
        }
        imageContext.drawImage(video, 0, 0, image.width, image.height);

        // Display exactly the clean still that will be sent to feature extraction.
        preview.width = image.width;
        preview.height = image.height;
        previewContext.drawImage(image, 0, 0, image.width, image.height);
        logCapture(videoId, "7. Capture: copied a clean camera frame into memory and displayed the same still for facial-feature comparison.");
        return image;
      } catch {
        logCapture(videoId, "7. Capture failed: the camera frame could not be copied. Restart recognition and try again.");
        return null;
      }
    }, [videoId]);

    useImperativeHandle(ref, () => ({
      stopFaceRecognition,
      startFaceRecognition,
      captureFrame,
    }));

    const setupCamera = async (session, canvas) => {
      logCapture(
        videoId,
        "2. Camera: requesting permission for a front-facing video stream."
      );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      if (session.cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        logCapture(videoId, "Cancelled camera request finished; unused stream released.");
        return;
      }

      session.stream = stream;
      const { video } = session;
      video.onloadedmetadata = () => {
        if (!session.cancelled) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          logCapture(
            videoId,
            "3. Video metadata: canvas dimensions now match the camera's native frame size."
          );
        }
      };
      // The muted video element starts playback through its autoPlay attribute.
      video.srcObject = stream;
      logCapture(
        videoId,
        "2. Camera: stream attached to the video element; waiting for metadata and playable frames."
      );
    };

    const loadModel = async (session, canvas) => {
      await initializeTensorflow(session);
      if (session.cancelled) {
        return;
      }
      logCapture(videoId, "5. Model: loading BlazeFace for face detection in the browser.");
      const model = await blazeface.load();
      if (session.cancelled) {
        model.dispose();
        logCapture(videoId, "Cancelled model load finished; unused model disposed.");
        return;
      }
      session.model = model;
      logCapture(videoId, "5. Model: ready to find face bounding boxes in video frames.");
      await detectFaces(session, canvas);
    };

    const initializeTensorflow = async (session) => {
      logCapture(videoId, "4. TensorFlow: trying the WebGL backend for browser inference.");
      let backend = "WebGL";
      try {
        // setBackend can report failure with false as well as by rejecting.
        if (!(await tf.setBackend("webgl"))) {
          throw new Error("WebGL backend unavailable");
        }
      } catch {
        backend = "CPU";
        logCapture(videoId, "4. TensorFlow: WebGL unavailable; falling back to CPU.");
        if (!(await tf.setBackend("cpu"))) {
          throw new Error("CPU backend unavailable");
        }
      }
      await tf.ready();
      if (!session.cancelled) {
        logCapture(videoId, `4. TensorFlow: ${backend} backend is ready.`);
      }
    };

    const detectFaces = async (session, canvas) => {
      if (session.cancelled) {
        return;
      }
      const { video } = session;
      if (video.readyState >= 2) {
        if (session.lastFaceCount === null) {
          logCapture(videoId, "6. Detection: estimating face boxes from a playable video frame.");
        }
        let predictions;
        session.estimating = true;
        try {
          predictions = await session.model.estimateFaces(video);
        } catch (error) {
          if (session.cancelled) {
            logCapture(videoId, "Cancelled estimate failed; ignoring the obsolete result.");
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
          logCapture(videoId, "Cancelled estimate finished; ignoring the obsolete detections.");
          return;
        }
        // Keep the latest result only, including an empty result when the face
        // leaves the frame. Never reuse a previous frame's face after that.
        predictionsRef.current = predictions;
        // This loop runs frequently, so report detection-count changes instead
        // of logging every frame or exposing coordinates/landmarks.
        if (session.lastFaceCount !== predictions.length) {
          logCapture(
            videoId,
            predictions.length
              ? `6. Detection result: ${predictions.length} face(s) found; latest boxes kept in memory.`
              : "6. Detection result: no face found; keep a face visible before pressing Stop."
          );
          session.lastFaceCount = predictions.length;
        }
        drawFrame(predictions, video, canvas, session);
        if (onFacesDetected) {
          onFacesDetected(predictions);
        }
      } else if (!session.waitingForFrameLogged) {
        logCapture(videoId, "6. Detection: waiting for a playable camera frame before inference.");
        session.waitingForFrameLogged = true;
      }
      if (!session.cancelled) {
        // Schedule the next estimate only after this one finishes; estimates
        // do not overlap, and cancellation prevents stale callbacks updating UI.
        session.animationFrameId = requestAnimationFrame(() =>
          detectFaces(session, canvas).catch(() => {
            if (!session.cancelled) {
              logCapture(videoId, "Detection failed; stopping this session. Start recognition to retry.");
              stopFaceRecognition();
              onRecognitionError?.();
            }
          })
        );
      }
    };

    const drawFrame = (predictions, video, canvas, session) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        if (!session.canvasUnavailableLogged) {
          logCapture(videoId, "6. Preview: a 2D canvas context is unavailable; the preview cannot be drawn.");
          session.canvasUnavailableLogged = true;
        }
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // This canvas is the live preview with boxes. Explicit captureFrame reads
      // the video into a separate clean canvas for facial-feature extraction.
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // BlazeFace provides opposite box corners; canvas needs x/y/width/height.
      predictions.forEach((prediction) => {
        const [x, y, width, height] = prediction.topLeft.concat(
          prediction.bottomRight
        );
        ctx.strokeStyle = frameColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width - x, height - y);
      });
      if (!session.previewLogged) {
        logCapture(videoId, "6. Preview: video image copied to canvas and detected face boxes drawn; repeating until Stop.");
        session.previewLogged = true;
      }
    };

    const startFaceRecognition = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (sessionRef.current || !video || !canvas) {
        logCapture(videoId, "Start skipped: detection is already active or its video/canvas is unavailable.");
        return;
      }

      // A restarted camera must not return detections from an earlier capture
      // if it is stopped before its first new estimate has completed.
      predictionsRef.current = null;
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      logCapture(videoId, "1. Start: clearing the previous preview and detections for a new capture session.");
      const session = {
        videoId,
        video,
        stream: null,
        model: null,
        animationFrameId: null,
        cancelled: false,
        estimating: false,
        lastFaceCount: null,
        waitingForFrameLogged: false,
        previewLogged: false,
        canvasUnavailableLogged: false,
      };
      sessionRef.current = session;
      try {
        await setupCamera(session, canvas);
        if (!session.cancelled) {
          await loadModel(session, canvas);
        }
      } catch (error) {
        if (!session.cancelled) {
          logCapture(videoId, "Startup failed; releasing camera/model resources. Check camera permission and try again.");
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
          playsInline
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
