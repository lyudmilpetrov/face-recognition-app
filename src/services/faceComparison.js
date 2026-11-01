// This model's 128 learned features describe facial appearance. Bounding-box
// size/location and the live BlazeFace overlay do not participate in the score.
export const FACE_DESCRIPTOR_LENGTH = 128;
export const FACE_MATCH_THRESHOLD = 0.6;
export const FACE_MODEL_VERSION = "face-api-1.7.15";
const MODEL_URL = `${import.meta.env.BASE_URL}models/${FACE_MODEL_VERSION}`;
let modelsPromise;

const errorMessages = {
  INVALID_IMAGE: "A captured image is unavailable. Start both cameras and capture again.",
  MODEL_LOAD_FAILED: "Unable to load facial-feature models. Check your connection and try again.",
  NO_FACE: "No face was found in a captured image. Capture one clearly visible face in each panel.",
  MULTIPLE_FACES: "More than one face was found. Capture only one face in each panel.",
  INVALID_DESCRIPTOR: "Facial features could not be extracted reliably. Capture both faces again.",
  COMPARISON_FAILED: "Unable to compare facial features. Capture both faces again and retry.",
};

export class FaceComparisonError extends Error {
  constructor(code) {
    super(errorMessages[code] || errorMessages.COMPARISON_FAILED);
    this.name = "FaceComparisonError";
    this.code = code;
  }
}

// Only our own known errors reach the UI; model/network exception details may
// contain implementation information and are never logged or shown to users.
export function getFaceComparisonErrorMessage(error) {
  return error instanceof FaceComparisonError
    ? errorMessages[error.code] || errorMessages.COMPARISON_FAILED
    : errorMessages.COMPARISON_FAILED;
}

async function loadModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      console.log("[FaceComparison] Step 2: Load the local detection, alignment, and facial-feature models.");
      // The no-bundle entry shares the app's TensorFlow 4 runtime. Lazy loading
      // keeps recognition code/weights out of the initial camera startup path.
      const api = await import("@vladmandic/face-api/dist/face-api.esm-nobundle.js");
      if (!api.tf.getBackend()) {
        let webglReady = false;
        try {
          webglReady = await api.tf.setBackend("webgl");
        } catch {
          // A CPU backend also supports the recognition model.
        }
        if (!webglReady && !(await api.tf.setBackend("cpu"))) {
          throw new FaceComparisonError("MODEL_LOAD_FAILED");
        }
      }
      await api.tf.ready();
      const nets = [api.nets.tinyFaceDetector, api.nets.faceLandmark68Net, api.nets.faceRecognitionNet];
      // Wait for every load to settle before permitting a retry, so a failed
      // request cannot leave another load racing a second initialization.
      const loads = await Promise.allSettled(
        nets.map((net) => net.isLoaded ? undefined : net.loadFromUri(MODEL_URL))
      );
      if (loads.some((load) => load.status === "rejected")) {
        throw new FaceComparisonError("MODEL_LOAD_FAILED");
      }
      return api;
    })().catch(() => {
      modelsPromise = undefined;
      throw new FaceComparisonError("MODEL_LOAD_FAILED");
    });
  }
  return modelsPromise;
}

function validateImage(image) {
  if (!(image instanceof HTMLCanvasElement) || image.width <= 0 || image.height <= 0) {
    throw new FaceComparisonError("INVALID_IMAGE");
  }
}

function validateDescriptor(descriptor) {
  if (
    !(descriptor instanceof Float32Array) ||
    descriptor.length !== FACE_DESCRIPTOR_LENGTH ||
    !descriptor.every(Number.isFinite) ||
    !descriptor.some((value) => value !== 0)
  ) {
    throw new FaceComparisonError("INVALID_DESCRIPTOR");
  }
}

export function compareFaceDescriptors(first, second) {
  validateDescriptor(first);
  validateDescriptor(second);
  // Use the Euclidean metric expected by this recognition model, without
  // renormalizing its output or inventing a percentage/identity probability.
  const distance = Math.hypot(...Array.from(first, (value, index) => value - second[index]));
  if (!Number.isFinite(distance)) {
    throw new FaceComparisonError("INVALID_DESCRIPTOR");
  }
  return { distance, threshold: FACE_MATCH_THRESHOLD, isMatch: distance < FACE_MATCH_THRESHOLD };
}

async function extractDescriptor(api, image) {
  const faces = await api.detectAllFaces(
    image,
    new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
  ).withFaceLandmarks().withFaceDescriptors();
  // Never silently select the first person from a group. The landmark step
  // aligns the detected face before the recognition network reads its pixels.
  if (!faces.length) throw new FaceComparisonError("NO_FACE");
  if (faces.length !== 1) throw new FaceComparisonError("MULTIPLE_FACES");
  validateDescriptor(faces[0].descriptor);
  return faces[0].descriptor;
}

// Enrollment callers own this transient descriptor. Never log it or persist it
// outside an explicitly encrypted vault record.
export async function extractFaceDescriptor(image) {
  validateImage(image);
  const api = await loadModels();
  try {
    return await extractDescriptor(api, image);
  } catch (error) {
    throw error instanceof FaceComparisonError ? error : new FaceComparisonError("COMPARISON_FAILED");
  }
}

export async function compareFaceImages(firstImage, secondImage) {
  validateImage(firstImage);
  validateImage(secondImage);
  const api = await loadModels();
  try {
    console.log("[FaceComparison] Step 3: Detect and align a single face in the first frozen image, then extract 128 learned features.");
    const first = await extractDescriptor(api, firstImage);
    console.log("[FaceComparison] Step 4: Detect and align a single face in the second frozen image, then extract the same learned features.");
    const second = await extractDescriptor(api, secondImage);
    console.log("[FaceComparison] Step 5: Compare feature vectors using Euclidean distance; smaller distances indicate more similar features.");
    // Descriptors stay inside this call. Return only the distance and decision;
    // no images, landmarks, or feature vectors are uploaded, persisted, or logged.
    return compareFaceDescriptors(first, second);
  } catch (error) {
    throw error instanceof FaceComparisonError ? error : new FaceComparisonError("COMPARISON_FAILED");
  }
}
