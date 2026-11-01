import React, { createRef, StrictMode, useEffect, useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import FaceRecognitionBlaze from "./FaceRecognitionBlaze";

const { getUserMedia, loadModel, estimateFaces, setBackend, ready } = vi.hoisted(
  () => ({
    getUserMedia: vi.fn(),
    loadModel: vi.fn(),
    estimateFaces: vi.fn(),
    setBackend: vi.fn(),
    ready: vi.fn(),
  })
);

vi.mock("@tensorflow/tfjs", () => ({ setBackend, ready }));
vi.mock("@tensorflow/tfjs-backend-cpu", () => ({}));
vi.mock("@tensorflow/tfjs-backend-webgl", () => ({}));
vi.mock("@tensorflow-models/blazeface", () => ({ load: loadModel }));

const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices"
);

let context;
let requestFrame;
let cancelFrame;
let captureLog;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cameraStream() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  return { stream, stop };
}

function renderRecognition(props = {}) {
  const ref = createRef();
  const view = render(
    <FaceRecognitionBlaze
      ref={ref}
      videoId="camera"
      canvasId="detections"
      frameColor="aqua"
      {...props}
    />
  );
  return { ...view, ref };
}

function setVideoDimensions(video, width = 640, height = 480) {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: height });
}

beforeEach(() => {
  vi.clearAllMocks();
  captureLog = vi.spyOn(console, "log").mockImplementation(() => {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  setBackend.mockResolvedValue(true);
  ready.mockResolvedValue();
  estimateFaces.mockResolvedValue([]);
  loadModel.mockResolvedValue({ estimateFaces, dispose: vi.fn() });

  requestFrame = vi.fn().mockReturnValue(0);
  cancelFrame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);

  context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (mediaDevicesDescriptor) {
    Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  } else {
    delete navigator.mediaDevices;
  }
});

test("can unmount before recognition starts, after React clears the video ref", () => {
  const { unmount } = renderRecognition();

  expect(() => unmount()).not.toThrow();
  expect(getUserMedia).not.toHaveBeenCalled();
});

test("unmount releases an active stream and cancels an animation frame with ID zero", async () => {
  const camera = cameraStream();
  getUserMedia.mockResolvedValue(camera.stream);
  const { ref, unmount, container } = renderRecognition();
  const video = container.querySelector("video");

  await act(async () => {
    await ref.current.startFaceRecognition();
  });

  expect(video.srcObject).toBe(camera.stream);
  expect(requestFrame).toHaveBeenCalledOnce();
  expect(() => unmount()).not.toThrow();
  expect(camera.stop).toHaveBeenCalledOnce();
  expect(video.srcObject).toBeNull();
  expect(cancelFrame).toHaveBeenCalledWith(0);
});

test("captures a clean native-size still before stopping the stream and keeps it separate from later previews", async () => {
  const camera = cameraStream();
  const restartedCamera = cameraStream();
  getUserMedia
    .mockResolvedValueOnce(camera.stream)
    .mockResolvedValueOnce(restartedCamera.stream);
  const { ref, container } = renderRecognition();
  const video = container.querySelector("video");
  const preview = container.querySelector("canvas");
  setVideoDimensions(video);
  await act(async () => {
    await ref.current.startFaceRecognition();
  });
  context.drawImage.mockClear();
  const imageContext = { drawImage: vi.fn(), clearRect: vi.fn(), strokeRect: vi.fn() };
  HTMLCanvasElement.prototype.getContext.mockImplementation(function () {
    return this === preview ? context : imageContext;
  });

  let image;
  act(() => {
    image = ref.current.captureFrame();
    ref.current.stopFaceRecognition();
  });

  expect(image).toBeInstanceOf(HTMLCanvasElement);
  expect(image).not.toBe(preview);
  expect(image.isConnected).toBe(false);
  expect(image.width).toBe(640);
  expect(image.height).toBe(480);
  expect(imageContext.drawImage).toHaveBeenCalledExactlyOnceWith(video, 0, 0, 640, 480);
  expect(imageContext.strokeRect).not.toHaveBeenCalled();
  expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 0, 640, 480);
  expect(preview.width).toBe(640);
  expect(preview.height).toBe(480);
  expect(imageContext.drawImage.mock.invocationCallOrder[0]).toBeLessThan(
    camera.stop.mock.invocationCallOrder[0]
  );

  await act(async () => {
    await ref.current.startFaceRecognition();
  });

  expect(imageContext.drawImage).toHaveBeenCalledOnce();
  expect(imageContext.clearRect).not.toHaveBeenCalled();
  expect(image.width).toBe(640);
  expect(image.height).toBe(480);
  expect(captureLog.mock.calls.flat().every((message) => typeof message === "string")).toBe(true);
});

test("does not capture before camera startup or after stop", async () => {
  const camera = cameraStream();
  getUserMedia.mockResolvedValue(camera.stream);
  const { ref, container } = renderRecognition();
  setVideoDimensions(container.querySelector("video"));
  expect(ref.current.captureFrame()).toBeNull();

  await act(async () => {
    await ref.current.startFaceRecognition();
  });
  act(() => {
    ref.current.stopFaceRecognition();
  });
  context.drawImage.mockClear();

  expect(ref.current.captureFrame()).toBeNull();
  expect(context.drawImage).not.toHaveBeenCalled();
});

test.each(["waiting for permission", "video not playable", "zero width", "zero height", "canvas unavailable"])(
  "does not capture when %s",
  async (condition) => {
    const camera = cameraStream();
    const permission = deferred();
    getUserMedia.mockReturnValue(permission.promise);
    const { ref, container } = renderRecognition();
    const video = container.querySelector("video");
    setVideoDimensions(video);
    let start;
    await act(async () => {
      start = ref.current.startFaceRecognition();
    });
    if (condition !== "waiting for permission") {
      await act(async () => {
        permission.resolve(camera.stream);
        await start;
      });
    }
    if (condition === "video not playable") {
      vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
    } else if (condition === "zero width") {
      setVideoDimensions(video, 0, 480);
    } else if (condition === "zero height") {
      setVideoDimensions(video, 640, 0);
    } else if (condition === "canvas unavailable") {
      HTMLCanvasElement.prototype.getContext.mockReturnValueOnce(null);
    }
    context.drawImage.mockClear();

    expect(ref.current.captureFrame()).toBeNull();
    expect(context.drawImage).not.toHaveBeenCalled();
    if (condition === "waiting for permission") {
      act(() => {
        ref.current.stopFaceRecognition();
      });
      await act(async () => {
        permission.resolve(camera.stream);
        await start;
      });
    }
  }
);

test.each(["stop", "unmount"])(
  "releases a camera stream that resolves after %s without starting detection",
  async (action) => {
    const permission = deferred();
    const camera = cameraStream();
    getUserMedia.mockReturnValue(permission.promise);
    const { ref, unmount } = renderRecognition();
    let start;
    act(() => {
      start = ref.current.startFaceRecognition();
    });

    if (action === "unmount") {
      expect(() => unmount()).not.toThrow();
    } else {
      act(() => {
        ref.current.stopFaceRecognition();
      });
    }

    await act(async () => {
      permission.resolve(camera.stream);
      await start;
    });

    expect(camera.stop).toHaveBeenCalledOnce();
    expect(loadModel).not.toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
  }
);

test("does not start detection when model loading finishes after a stop", async () => {
  const modelLoading = deferred();
  const camera = cameraStream();
  const model = { estimateFaces: vi.fn().mockResolvedValue([]), dispose: vi.fn() };
  getUserMedia.mockResolvedValue(camera.stream);
  loadModel.mockReturnValue(modelLoading.promise);
  const { ref } = renderRecognition();
  let start;
  await act(async () => {
    start = ref.current.startFaceRecognition();
  });
  expect(loadModel).toHaveBeenCalledOnce();

  act(() => {
    ref.current.stopFaceRecognition();
    ref.current.stopFaceRecognition();
  });
  await act(async () => {
    modelLoading.resolve(model);
    await start;
  });

  expect(camera.stop).toHaveBeenCalledOnce();
  expect(model.estimateFaces).not.toHaveBeenCalled();
  expect(model.dispose).toHaveBeenCalledOnce();
  expect(requestFrame).not.toHaveBeenCalled();
});

test.each(["stop", "unmount"])(
  "ignores an in-flight face estimate that finishes after %s",
  async (action) => {
    const estimation = deferred();
    const camera = cameraStream();
    const onFacesDetected = vi.fn();
    getUserMedia.mockResolvedValue(camera.stream);
    estimateFaces.mockReturnValue(estimation.promise);
    const { ref, unmount } = renderRecognition({ onFacesDetected });
    let start;
    await act(async () => {
      start = ref.current.startFaceRecognition();
    });
    expect(estimateFaces).toHaveBeenCalledOnce();

    if (action === "unmount") {
      expect(() => unmount()).not.toThrow();
    } else {
      act(() => {
        ref.current.stopFaceRecognition();
      });
    }
    await act(async () => {
      estimation.resolve([{ topLeft: [0, 0], bottomRight: [20, 20] }]);
      await start;
    });

    expect(camera.stop).toHaveBeenCalledOnce();
    expect(onFacesDetected).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
  }
);

test("a later animation-frame estimate can reject after stop without stale work or an unhandled rejection", async () => {
  const estimation = deferred();
  const camera = cameraStream();
  const onFacesDetected = vi.fn();
  const onRecognitionError = vi.fn();
  getUserMedia.mockResolvedValue(camera.stream);
  estimateFaces
    .mockResolvedValueOnce([])
    .mockReturnValueOnce(estimation.promise);
  const { ref } = renderRecognition({ onFacesDetected, onRecognitionError });
  await act(async () => {
    await ref.current.startFaceRecognition();
  });

  const nextFrame = requestFrame.mock.calls[0][0];
  onFacesDetected.mockClear();
  context.drawImage.mockClear();
  requestFrame.mockClear();
  let frameRun;
  act(() => {
    frameRun = nextFrame();
    ref.current.stopFaceRecognition();
  });
  expect(estimateFaces).toHaveBeenCalledTimes(2);
  await act(async () => {
    estimation.reject(new Error("Camera stopped during estimation"));
    await expect(frameRun).resolves.toBeUndefined();
  });

  expect(camera.stop).toHaveBeenCalledOnce();
  expect(onFacesDetected).not.toHaveBeenCalled();
  expect(onRecognitionError).not.toHaveBeenCalled();
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(requestFrame).not.toHaveBeenCalled();
});

test("logs capture stages and face-count changes without repeating every frame or exposing predictions", async () => {
  const camera = cameraStream();
  const predictions = [{
    topLeft: [12345, 23456],
    bottomRight: [34567, 45678],
    privateMarker: "sensitive-face-payload",
  }];
  getUserMedia.mockResolvedValue(camera.stream);
  estimateFaces.mockResolvedValue(predictions);
  const { ref, container } = renderRecognition();
  const video = container.querySelector("video");
  const canvas = container.querySelector("canvas");
  Object.defineProperty(video, "videoWidth", { configurable: true, value: 640 });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: 480 });

  await act(async () => {
    await ref.current.startFaceRecognition();
  });
  fireEvent.loadedMetadata(video);

  expect(canvas.width).toBe(640);
  expect(canvas.height).toBe(480);
  const initialLogCount = captureLog.mock.calls.length;
  for (let frame = 0; frame < 4; frame += 1) {
    await act(async () => {
      await requestFrame.mock.lastCall[0]();
    });
  }
  expect(estimateFaces).toHaveBeenCalledTimes(5);
  expect(captureLog).toHaveBeenCalledTimes(initialLogCount);

  estimateFaces.mockResolvedValueOnce([]);
  await act(async () => {
    await requestFrame.mock.lastCall[0]();
  });
  expect(captureLog).toHaveBeenCalledTimes(initialLogCount + 1);
  expect(captureLog).toHaveBeenLastCalledWith(
    expect.stringContaining("no face found")
  );
  act(() => {
    expect(ref.current.stopFaceRecognition()).toEqual([]);
  });

  const messages = captureLog.mock.calls.map(([message]) => message);
  expect(messages).toEqual(expect.arrayContaining([
    expect.stringContaining("1. Start:"),
    expect.stringContaining("2. Camera:"),
    expect.stringContaining("3. Video metadata:"),
    expect.stringContaining("4. TensorFlow:"),
    expect.stringContaining("5. Model:"),
    expect.stringContaining("6. Detection:"),
    expect.stringContaining("6. Preview:"),
    expect.stringContaining("7. Stop:"),
    expect.stringContaining("8. Cleanup:"),
  ]));
  for (const args of captureLog.mock.calls) {
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/^\[FaceCapture:camera\] /);
    expect(args[0]).not.toMatch(/sensitive-face-payload|12345|23456|34567|45678/);
  }
});

test("restart clears old detections before the new session's first estimate completes", async () => {
  const oldCamera = cameraStream();
  const newCamera = cameraStream();
  const oldPredictions = [{ topLeft: [1, 2], bottomRight: [21, 22] }];
  const estimation = deferred();
  getUserMedia
    .mockResolvedValueOnce(oldCamera.stream)
    .mockResolvedValueOnce(newCamera.stream);
  estimateFaces
    .mockResolvedValueOnce(oldPredictions)
    .mockReturnValueOnce(estimation.promise);
  const { ref } = renderRecognition();
  await act(async () => {
    await ref.current.startFaceRecognition();
  });
  act(() => {
    expect(ref.current.stopFaceRecognition()).toBe(oldPredictions);
  });
  context.clearRect.mockClear();
  context.drawImage.mockClear();

  let restarted;
  await act(async () => {
    restarted = ref.current.startFaceRecognition();
  });
  expect(estimateFaces).toHaveBeenCalledTimes(2);
  expect(context.clearRect).toHaveBeenCalledOnce();
  act(() => {
    expect(ref.current.stopFaceRecognition()).toBeNull();
  });
  await act(async () => {
    estimation.resolve(oldPredictions);
    await restarted;
  });

  expect(context.drawImage).not.toHaveBeenCalled();
  expect(oldCamera.stop).toHaveBeenCalledOnce();
  expect(newCamera.stop).toHaveBeenCalledOnce();
});

test.each(["returns false", "rejects"])(
  "uses the CPU backend when WebGL %s",
  async (failure) => {
    const camera = cameraStream();
    getUserMedia.mockResolvedValue(camera.stream);
    if (failure === "returns false") {
      setBackend.mockResolvedValueOnce(false);
    } else {
      setBackend.mockRejectedValueOnce(new Error("WebGL unavailable"));
    }
    const { ref } = renderRecognition();

    await act(async () => {
      await ref.current.startFaceRecognition();
    });

    expect(setBackend).toHaveBeenNthCalledWith(1, "webgl");
    expect(setBackend).toHaveBeenNthCalledWith(2, "cpu");
    expect(ready).toHaveBeenCalledOnce();
    expect(loadModel).toHaveBeenCalledOnce();
    expect(estimateFaces).toHaveBeenCalledOnce();
    expect(captureLog).toHaveBeenCalledWith(
      expect.stringContaining("CPU backend is ready")
    );
  }
);

test("a later detection failure stops the camera and reports one safe recognition error", async () => {
  const camera = cameraStream();
  const dispose = vi.fn();
  const onRecognitionError = vi.fn();
  getUserMedia.mockResolvedValue(camera.stream);
  loadModel.mockResolvedValue({ estimateFaces, dispose });
  estimateFaces
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("private-model-error-details"));
  const { ref, container } = renderRecognition({ onRecognitionError });
  await act(async () => {
    await ref.current.startFaceRecognition();
  });
  const nextFrame = requestFrame.mock.lastCall[0];
  requestFrame.mockClear();

  await act(async () => {
    await expect(nextFrame()).resolves.toBeUndefined();
  });
  act(() => {
    ref.current.stopFaceRecognition();
  });

  expect(camera.stop).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
  expect(container.querySelector("video").srcObject).toBeNull();
  expect(requestFrame).not.toHaveBeenCalled();
  expect(cancelFrame).toHaveBeenCalledWith(0);
  expect(onRecognitionError).toHaveBeenCalledExactlyOnceWith();
  expect(captureLog.mock.calls.flat().join(" ")).not.toContain(
    "private-model-error-details"
  );
});

test("a late camera result from an earlier run cannot replace a restarted camera", async () => {
  const oldPermission = deferred();
  const oldCamera = cameraStream();
  const newCamera = cameraStream();
  getUserMedia
    .mockReturnValueOnce(oldPermission.promise)
    .mockResolvedValueOnce(newCamera.stream);
  const { ref, container } = renderRecognition();
  let firstStart;
  act(() => {
    firstStart = ref.current.startFaceRecognition();
    ref.current.stopFaceRecognition();
  });
  await act(async () => {
    await ref.current.startFaceRecognition();
  });
  await act(async () => {
    oldPermission.resolve(oldCamera.stream);
    await firstStart;
  });

  expect(oldCamera.stop).toHaveBeenCalledOnce();
  expect(newCamera.stop).not.toHaveBeenCalled();
  expect(container.querySelector("video").srcObject).toBe(newCamera.stream);
  expect(loadModel).toHaveBeenCalledOnce();
});

test("Strict Mode effect replay releases the first pending stream and keeps the current one", async () => {
  const firstPermission = deferred();
  const secondPermission = deferred();
  const firstCamera = cameraStream();
  const secondCamera = cameraStream();
  getUserMedia
    .mockReturnValueOnce(firstPermission.promise)
    .mockReturnValueOnce(secondPermission.promise);

  function AutoStartRecognition() {
    const ref = useRef(null);
    useEffect(() => {
      ref.current.startFaceRecognition();
    }, []);
    return (
      <FaceRecognitionBlaze
        ref={ref}
        videoId="strict-camera"
        canvasId="strict-detections"
        frameColor="aqua"
      />
    );
  }

  const { container, unmount } = render(
    <StrictMode>
      <AutoStartRecognition />
    </StrictMode>
  );
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  await act(async () => {
    firstPermission.resolve(firstCamera.stream);
    secondPermission.resolve(secondCamera.stream);
  });

  expect(firstCamera.stop).toHaveBeenCalledOnce();
  expect(secondCamera.stop).not.toHaveBeenCalled();
  expect(container.querySelector("video").srcObject).toBe(secondCamera.stream);
  expect(loadModel).toHaveBeenCalledOnce();
  expect(() => unmount()).not.toThrow();
  expect(secondCamera.stop).toHaveBeenCalledOnce();
});
