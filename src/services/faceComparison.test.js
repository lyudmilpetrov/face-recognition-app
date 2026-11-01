import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tf: { getBackend: vi.fn(), setBackend: vi.fn(), ready: vi.fn() },
  tinyFaceDetector: { isLoaded: false, loadFromUri: vi.fn() },
  faceLandmark68Net: { isLoaded: false, loadFromUri: vi.fn() },
  faceRecognitionNet: { isLoaded: false, loadFromUri: vi.fn() },
  detectAllFaces: vi.fn(),
  TinyFaceDetectorOptions: vi.fn(function (options) { Object.assign(this, options); }),
  withFaceLandmarks: vi.fn(),
  withFaceDescriptors: vi.fn(),
}));

vi.mock("@vladmandic/face-api/dist/face-api.esm-nobundle.js", () => ({
  tf: mocks.tf,
  nets: {
    tinyFaceDetector: mocks.tinyFaceDetector,
    faceLandmark68Net: mocks.faceLandmark68Net,
    faceRecognitionNet: mocks.faceRecognitionNet,
  },
  detectAllFaces: mocks.detectAllFaces,
  TinyFaceDetectorOptions: mocks.TinyFaceDetectorOptions,
}));

const modelNets = [mocks.tinyFaceDetector, mocks.faceLandmark68Net, mocks.faceRecognitionNet];

function descriptor() {
  const features = new Float32Array(128);
  features[0] = 1;
  return features;
}

function image() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  return canvas;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("BASE_URL", "/face-recognition-app/");
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.tf.getBackend.mockReturnValue("webgl");
  mocks.tf.setBackend.mockReset().mockResolvedValue(true);
  mocks.tf.ready.mockReset().mockResolvedValue();
  for (const net of modelNets) {
    net.isLoaded = false;
    net.loadFromUri.mockReset().mockImplementation(async () => {
      net.isLoaded = true;
    });
  }
  mocks.withFaceDescriptors.mockReset().mockImplementation(async () => [{ descriptor: descriptor() }]);
  mocks.withFaceLandmarks.mockReset().mockReturnValue({ withFaceDescriptors: mocks.withFaceDescriptors });
  mocks.detectAllFaces.mockReset().mockReturnValue({ withFaceLandmarks: mocks.withFaceLandmarks });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("identical learned features have zero distance and different features preserve their distance", async () => {
  const { compareFaceDescriptors, FACE_MATCH_THRESHOLD } = await import("./faceComparison");
  const first = descriptor();
  const close = descriptor();
  const different = descriptor();
  close[1] = 0.25;
  different[1] = 1;

  expect(compareFaceDescriptors(first, descriptor())).toEqual({ distance: 0, threshold: FACE_MATCH_THRESHOLD, isMatch: true });
  expect(compareFaceDescriptors(first, close)).toEqual({ distance: 0.25, threshold: FACE_MATCH_THRESHOLD, isMatch: true });
  expect(compareFaceDescriptors(first, different)).toEqual({ distance: 1, threshold: FACE_MATCH_THRESHOLD, isMatch: false });
});

test("the match threshold is exclusive", async () => {
  const { compareFaceDescriptors, FACE_MATCH_THRESHOLD } = await import("./faceComparison");
  // Float32 components cannot represent 0.6 exactly. Control the distance at
  // this boundary to verify the decision independently of float rounding.
  vi.spyOn(Math, "hypot").mockReturnValue(FACE_MATCH_THRESHOLD);

  expect(compareFaceDescriptors(descriptor(), descriptor()).isMatch).toBe(false);
});

test.each([
  ["plain array", () => Array.from(descriptor())],
  ["wrong size", () => new Float32Array(127).fill(1)],
  ["NaN", () => { const value = descriptor(); value[10] = NaN; return value; }],
  ["infinity", () => { const value = descriptor(); value[10] = Infinity; return value; }],
  ["zero vector", () => new Float32Array(128)],
])("rejects a %s descriptor on either side", async (_label, invalid) => {
  const { compareFaceDescriptors } = await import("./faceComparison");

  expect(() => compareFaceDescriptors(invalid(), descriptor())).toThrow(expect.objectContaining({ code: "INVALID_DESCRIPTOR" }));
  expect(() => compareFaceDescriptors(descriptor(), invalid())).toThrow(expect.objectContaining({ code: "INVALID_DESCRIPTOR" }));
});

test("extracts aligned descriptors from both frozen canvases using local model URLs", async () => {
  const { compareFaceImages } = await import("./faceComparison");
  const firstImage = image();
  const secondImage = image();

  await expect(compareFaceImages(firstImage, secondImage)).resolves.toEqual({ distance: 0, threshold: 0.6, isMatch: true });

  for (const net of modelNets) {
    expect(net.loadFromUri).toHaveBeenCalledExactlyOnceWith("/face-recognition-app/models/face-api-1.7.15");
  }
  expect(mocks.detectAllFaces).toHaveBeenNthCalledWith(1, firstImage, expect.objectContaining({ inputSize: 416, scoreThreshold: 0.5 }));
  expect(mocks.detectAllFaces).toHaveBeenNthCalledWith(2, secondImage, expect.any(Object));
  expect(mocks.withFaceLandmarks).toHaveBeenCalledTimes(2);
  expect(mocks.withFaceLandmarks).toHaveBeenNthCalledWith(1);
  expect(mocks.withFaceDescriptors).toHaveBeenCalledTimes(2);
  expect(mocks.tf.ready).toHaveBeenCalledOnce();
  expect(mocks.tf.setBackend).not.toHaveBeenCalled();
  for (const call of console.log.mock.calls) {
    expect(call).toHaveLength(1);
    expect(call[0]).toMatch(/^\[FaceComparison\] /);
  }
});

test("provides one transient descriptor for enrollment without weakening single-face validation", async () => {
  const { extractFaceDescriptor, FACE_MODEL_VERSION } = await import("./faceComparison");
  const canvas = image();
  const features = await extractFaceDescriptor(canvas);
  expect(features).toEqual(descriptor());
  expect(FACE_MODEL_VERSION).toBe("face-api-1.7.15");
  expect(mocks.detectAllFaces).toHaveBeenCalledExactlyOnceWith(canvas, expect.any(Object));
  mocks.withFaceDescriptors.mockResolvedValueOnce([]);
  await expect(extractFaceDescriptor(canvas)).rejects.toMatchObject({ code: "NO_FACE" });
  mocks.withFaceDescriptors.mockRejectedValueOnce(new Error("private diagnostics"));
  await expect(extractFaceDescriptor(canvas)).rejects.toMatchObject({ code: "COMPARISON_FAILED" });
  await expect(extractFaceDescriptor(null)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
});

test.each([
  ["missing image", () => null],
  ["canvas-like object", () => ({ width: 640, height: 480 })],
  ["empty canvas", () => { const canvas = image(); canvas.width = 0; return canvas; }],
])("rejects a %s before loading models", async (_label, invalid) => {
  const { compareFaceImages } = await import("./faceComparison");

  await expect(compareFaceImages(invalid(), image())).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  await expect(compareFaceImages(image(), invalid())).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  expect(mocks.tinyFaceDetector.loadFromUri).not.toHaveBeenCalled();
  expect(mocks.detectAllFaces).not.toHaveBeenCalled();
});

test.each([
  { label: "no faces", faces: [], code: "NO_FACE" },
  { label: "multiple faces", faces: [{ descriptor: descriptor() }, { descriptor: descriptor() }], code: "MULTIPLE_FACES" },
])("requires one face when an image contains $label", async ({ faces, code }) => {
  const { compareFaceImages, getFaceComparisonErrorMessage } = await import("./faceComparison");
  mocks.withFaceDescriptors.mockResolvedValueOnce(faces);

  const error = await compareFaceImages(image(), image()).catch((failure) => failure);

  expect(error).toMatchObject({ code });
  expect(getFaceComparisonErrorMessage(error)).toMatch(/face/i);
  expect(mocks.detectAllFaces).toHaveBeenCalledOnce();
});

test("also rejects a second image without a face", async () => {
  const { compareFaceImages } = await import("./faceComparison");
  mocks.withFaceDescriptors
    .mockResolvedValueOnce([{ descriptor: descriptor() }])
    .mockResolvedValueOnce([]);

  await expect(compareFaceImages(image(), image())).rejects.toMatchObject({ code: "NO_FACE" });
  expect(mocks.detectAllFaces).toHaveBeenCalledTimes(2);
});

test("rejects invalid extracted features without exposing their data in logs", async () => {
  const { compareFaceImages } = await import("./faceComparison");
  const invalid = descriptor();
  invalid[0] = NaN;
  mocks.withFaceDescriptors.mockResolvedValueOnce([{ descriptor: invalid, privateMarker: "sensitive-payload" }]);

  await expect(compareFaceImages(image(), image())).rejects.toMatchObject({ code: "INVALID_DESCRIPTOR" });
  expect(console.log.mock.calls.every((args) => args.length === 1 && typeof args[0] === "string")).toBe(true);
  expect(console.log.mock.calls.flat().join(" ")).not.toMatch(/sensitive-payload|NaN/);
});

test("concurrent comparisons share one model initialization", async () => {
  const { compareFaceImages } = await import("./faceComparison");
  const loading = deferred();
  mocks.faceRecognitionNet.loadFromUri.mockReturnValueOnce(loading.promise);

  const first = compareFaceImages(image(), image());
  const second = compareFaceImages(image(), image());
  await vi.waitFor(() => expect(mocks.faceRecognitionNet.loadFromUri).toHaveBeenCalledOnce());
  expect(mocks.detectAllFaces).not.toHaveBeenCalled();
  loading.resolve();

  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  for (const net of modelNets) expect(net.loadFromUri).toHaveBeenCalledOnce();
  expect(mocks.detectAllFaces).toHaveBeenCalledTimes(4);
});

test("failed model initialization waits for other loads and then allows a clean retry", async () => {
  const { compareFaceImages, getFaceComparisonErrorMessage } = await import("./faceComparison");
  const lateLoad = deferred();
  const modelError = new Error("private-network-location");
  mocks.tinyFaceDetector.loadFromUri.mockRejectedValueOnce(modelError);
  mocks.faceRecognitionNet.loadFromUri.mockImplementationOnce(async () => {
    await lateLoad.promise;
    mocks.faceRecognitionNet.isLoaded = true;
  });
  const first = compareFaceImages(image(), image()).catch((failure) => failure);
  let firstSettled = false;
  first.then(() => { firstSettled = true; });
  await vi.waitFor(() => expect(mocks.faceRecognitionNet.loadFromUri).toHaveBeenCalledOnce());
  const concurrent = compareFaceImages(image(), image()).catch((failure) => failure);
  expect(firstSettled).toBe(false);
  expect(mocks.tinyFaceDetector.loadFromUri).toHaveBeenCalledOnce();
  lateLoad.resolve();

  const failures = await Promise.all([first, concurrent]);
  for (const failure of failures) {
    expect(failure).toMatchObject({ code: "MODEL_LOAD_FAILED" });
    expect(getFaceComparisonErrorMessage(failure)).not.toContain(modelError.message);
  }
  await expect(compareFaceImages(image(), image())).resolves.toMatchObject({ isMatch: true });
  expect(mocks.tinyFaceDetector.loadFromUri).toHaveBeenCalledTimes(2);
  expect(mocks.faceLandmark68Net.loadFromUri).toHaveBeenCalledOnce();
  expect(mocks.faceRecognitionNet.loadFromUri).toHaveBeenCalledOnce();
  expect(console.log.mock.calls.flat().join(" ")).not.toContain(modelError.message);
});

test.each(["false", "rejection"])("falls back to CPU when WebGL initialization returns %s", async (failure) => {
  const { compareFaceImages } = await import("./faceComparison");
  mocks.tf.getBackend.mockReturnValue(undefined);
  if (failure === "false") mocks.tf.setBackend.mockResolvedValueOnce(false);
  else mocks.tf.setBackend.mockRejectedValueOnce(new Error("private-webgl-diagnostic"));

  await expect(compareFaceImages(image(), image())).resolves.toMatchObject({ isMatch: true });
  expect(mocks.tf.setBackend).toHaveBeenNthCalledWith(1, "webgl");
  expect(mocks.tf.setBackend).toHaveBeenNthCalledWith(2, "cpu");
});

test("unexpected inference errors become safe user-facing errors", async () => {
  const { compareFaceImages, getFaceComparisonErrorMessage } = await import("./faceComparison");
  const privateError = new Error("private-inference-stack-or-path");
  mocks.withFaceDescriptors.mockRejectedValueOnce(privateError);

  const failure = await compareFaceImages(image(), image()).catch((error) => error);

  expect(failure).toMatchObject({ code: "COMPARISON_FAILED" });
  expect(getFaceComparisonErrorMessage(failure)).toBe("Unable to compare facial features. Capture both faces again and retry.");
  expect(getFaceComparisonErrorMessage(privateError)).not.toContain(privateError.message);
  expect(getFaceComparisonErrorMessage({ code: "NO_FACE", message: "private-payload" })).toBe(getFaceComparisonErrorMessage(privateError));
  expect(console.log.mock.calls.flat().join(" ")).not.toContain(privateError.message);
});
