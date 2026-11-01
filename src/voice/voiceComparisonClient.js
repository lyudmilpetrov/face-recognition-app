import { decodeVoiceRecording, VoiceComparisonError } from "./audio.js";

export { getVoiceErrorMessage } from "./audio.js";

export function createVoiceComparisonClient() {
  let worker;
  let pending;
  let disposed = false;
  let sequence = 0;

  const rejectPending = (message) => {
    if (!pending) return;
    const { reject } = pending;
    pending = null;
    reject(new VoiceComparisonError(message));
  };

  const getWorker = () => {
    if (!worker) {
      worker = new Worker(new URL("./voiceComparison.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (!pending || pending.id !== data.id) return;
        if (data.type === "progress") {
          pending.onProgress(data.message);
        } else if (data.type === "result") {
          const { resolve } = pending;
          pending = null;
          resolve(data.score);
        } else if (data.type === "error") {
          rejectPending(data.message);
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        worker?.terminate();
        worker = null;
        rejectPending("Voice comparison stopped unexpectedly. Please try again in a current browser.");
      };
      worker.onmessageerror = () => {
        worker?.terminate();
        worker = null;
        rejectPending("Voice comparison stopped unexpectedly. Please try again.");
      };
    }
    return worker;
  };

  return {
    compare(referenceBlob, testBlob, onProgress = () => {}) {
      if (disposed) return Promise.reject(new VoiceComparisonError("Comparison cancelled."));
      if (pending) return Promise.reject(new VoiceComparisonError("A voice comparison is already running."));
      if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
        return Promise.reject(new VoiceComparisonError("Voice comparison requires a browser with Web Worker and WebAssembly support."));
      }

      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject, onProgress };
        const prepare = async () => {
          try {
            onProgress("Preparing reference recording...");
            const reference = await decodeVoiceRecording(referenceBlob);
            if (disposed || pending?.id !== id) return;
            onProgress("Preparing test recording...");
            const test = await decodeVoiceRecording(testBlob);
            if (disposed || pending?.id !== id) return;
            onProgress("Loading the local voice model...");
            getWorker().postMessage({ id, reference, test }, [reference.buffer, test.buffer]);
          } catch (error) {
            if (pending?.id !== id) return;
            pending = null;
            reject(error instanceof VoiceComparisonError
              ? error
              : new VoiceComparisonError("Unable to prepare voice comparison. Please try again in a current browser."));
          }
        };
        void prepare();
      });
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      rejectPending("Comparison cancelled.");
    },
  };
}
