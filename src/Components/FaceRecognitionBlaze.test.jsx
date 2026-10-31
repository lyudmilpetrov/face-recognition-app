import React, { createRef, StrictMode, useEffect, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
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

beforeEach(() => {
  vi.clearAllMocks();
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
  getUserMedia.mockResolvedValue(camera.stream);
  estimateFaces
    .mockResolvedValueOnce([])
    .mockReturnValueOnce(estimation.promise);
  const { ref } = renderRecognition({ onFacesDetected });
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
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(requestFrame).not.toHaveBeenCalled();
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
