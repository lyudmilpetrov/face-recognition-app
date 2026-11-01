import { LocalSpeechError, prepareSpeechModel, startModelSpeech, supportsModelSpeech } from "./localSpeechRecognition.js";
import { startMicrophoneVisualization } from "./microphoneVisualization.js";

export const TRANSLATION_LANGUAGES = [
  { code: "en", name: "English", speech: "en-US" },
  { code: "es", name: "Spanish", speech: "es-ES" },
  { code: "fr", name: "French", speech: "fr-FR" },
  { code: "de", name: "German", speech: "de-DE" },
  { code: "it", name: "Italian", speech: "it-IT" },
  { code: "pt", name: "Portuguese", speech: "pt-BR" },
  { code: "ru", name: "Russian", speech: "ru-RU" },
  { code: "ja", name: "Japanese", speech: "ja-JP" },
  { code: "zh", name: "Chinese", speech: "zh-CN" },
];

const messages = {
  TRANSLATION_UNSUPPORTED: "On-device translation is unavailable in this browser. Try a supported desktop browser with the Translator API.",
  LANGUAGE_UNAVAILABLE: "This language pair is unavailable for on-device translation. Choose another pair.",
  SPEECH_UNSUPPORTED: "On-device speech recognition is unavailable. You can type your text below instead.",
  SPEECH_DOWNLOAD: "The speech language could not be downloaded. Try again, or type your text below.",
  SPEECH_DOWNLOAD_BLOCKED: "The browser did not allow the speech language download. Check site permissions, then press Start microphone again to retry.",
  SPEECH_PERMISSION: "Microphone access was blocked. Allow microphone access in your browser's site settings, then press Start microphone again.",
  SPEECH_NO_SPEECH: "No speech was detected. Check your microphone, then press Start microphone and speak clearly.",
  SPEECH_MICROPHONE: "Your microphone could not be accessed. Check that it is connected and available, then try again.",
  SPEECH_LANGUAGE: "The selected speech language is not ready for on-device recognition. Download its language pack or choose another source language.",
  SPEECH_BLOCKED: "On-device speech recognition was blocked by the browser. Check site permissions and language support, then try again.",
  SPEECH_FAILED: "The microphone could not transcribe speech locally. Check permissions and try again, or type your text below.",
  TRANSLATION_FAILED: "Unable to translate locally. Check language support and available storage, then try again.",
  TRANSLATION_DOWNLOAD_BLOCKED: "The browser did not allow the translation model download. Check site permissions, then press Start microphone or Translate text again to retry.",
  INVALID_TEXT: "Enter between 1 and 5,000 characters to translate.",
};

export class VoiceTranslationError extends Error {
  constructor(code) {
    super(messages[code] || messages.TRANSLATION_FAILED);
    this.name = "VoiceTranslationError";
    this.code = code;
  }
}

export function getTranslationErrorMessage(error) {
  if (error instanceof LocalSpeechError) return error.message;
  return error instanceof VoiceTranslationError
    ? messages[error.code] || messages.TRANSLATION_FAILED
    : messages.TRANSLATION_FAILED;
}

function translatorApi() {
  const api = globalThis.Translator;
  if (typeof api?.availability !== "function" || typeof api?.create !== "function") {
    throw new VoiceTranslationError("TRANSLATION_UNSUPPORTED");
  }
  return api;
}

function speechApi() {
  const api = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  // Older Web Speech implementations default to remote recognition. Never use
  // them merely because recognition itself is present.
  if (!api?.prototype || !("processLocally" in api.prototype)
    || typeof api.available !== "function" || typeof api.install !== "function") {
    throw new VoiceTranslationError("SPEECH_UNSUPPORTED");
  }
  return api;
}

export async function getTranslationAvailability(sourceLanguage, targetLanguage) {
  if (sourceLanguage === targetLanguage) return "unavailable";
  try {
    return await translatorApi().availability({ sourceLanguage, targetLanguage });
  } catch (error) {
    if (error instanceof VoiceTranslationError) return "unsupported";
    return "unavailable";
  }
}

export async function getSpeechAvailability(language) {
  try {
    const availability = await speechApi().available({ langs: [language], processLocally: true });
    return availability === "unavailable" && supportsModelSpeech() ? "model" : availability;
  } catch (error) {
    if (supportsModelSpeech()) return "model";
    if (error instanceof VoiceTranslationError) return "unsupported";
    return "unavailable";
  }
}

export async function prepareLocalSpeech(language, { availability, signal, onProgress } = {}) {
  const support = availability === "checking" ? await getSpeechAvailability(language) : availability;
  if (support === "model") {
    const transcriber = await prepareSpeechModel({ signal, onProgress });
    return {
      start: (callbacks) => startModelSpeech(language, { transcriber, signal, ...callbacks }),
      dispose: () => transcriber.dispose(),
    };
  }
  if (["downloadable", "downloading"].includes(support)) await installSpeechLanguage(language);
  return { start: (callbacks) => startLocalSpeech(language, callbacks), dispose() {} };
}

export async function installSpeechLanguage(language) {
  try {
    // Invoke directly from a user action, including Start microphone, while
    // the browser still has the activation needed to install a language pack.
    const installed = await speechApi().install({ langs: [language], processLocally: true });
    if (!installed) throw new VoiceTranslationError("SPEECH_DOWNLOAD");
  } catch (error) {
    if (error?.name === "NotAllowedError") throw new VoiceTranslationError("SPEECH_DOWNLOAD_BLOCKED");
    throw error instanceof VoiceTranslationError ? error : new VoiceTranslationError("SPEECH_DOWNLOAD");
  }
}

export async function prepareLocalTranslator(sourceLanguage, targetLanguage, { signal, onProgress } = {}) {
  if (sourceLanguage === targetLanguage) throw new VoiceTranslationError("LANGUAGE_UNAVAILABLE");
  try {
    // Invoke create before any await, preserving the button's transient user
    // activation required by browsers when a language model must download.
    return await translatorApi().create({
      sourceLanguage,
      targetLanguage,
      signal,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          if (!signal?.aborted) onProgress?.(Math.round(Math.max(0, Math.min(1, event.loaded)) * 100));
        });
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (error?.name === "NotAllowedError") throw new VoiceTranslationError("TRANSLATION_DOWNLOAD_BLOCKED");
    throw error instanceof VoiceTranslationError ? error : new VoiceTranslationError("TRANSLATION_FAILED");
  }
}

export async function translateLocalText(translator, text, signal) {
  if (typeof text !== "string" || !text.trim() || text.length > 5000) throw new VoiceTranslationError("INVALID_TEXT");
  try {
    const result = await translator.translate(text, { signal });
    if (typeof result !== "string" || !result.trim()) throw new VoiceTranslationError("TRANSLATION_FAILED");
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw error instanceof VoiceTranslationError ? error : new VoiceTranslationError("TRANSLATION_FAILED");
  }
}

function speechFailure(error) {
  const codes = {
    "not-allowed": "SPEECH_PERMISSION",
    NotAllowedError: "SPEECH_PERMISSION",
    "no-speech": "SPEECH_NO_SPEECH",
    "audio-capture": "SPEECH_MICROPHONE",
    NotFoundError: "SPEECH_MICROPHONE",
    NotReadableError: "SPEECH_MICROPHONE",
    "language-not-supported": "SPEECH_LANGUAGE",
    "service-not-allowed": "SPEECH_BLOCKED",
  };
  return new VoiceTranslationError(codes[error?.error || error?.name] || "SPEECH_FAILED");
}

export function startLocalSpeech(language, { onStart, onAudioSource, onCaptureEnd, onText, onInterim, onEnd, onError }) {
  const Recognition = speechApi();
  const recognition = new Recognition();
  recognition.processLocally = true;
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  let active = true;
  let stopping = false;
  let timer;
  let visualization;
  let captureEnded = false;
  const visualizationController = new AbortController();
  const endCapture = () => {
    if (captureEnded) return;
    captureEnded = true;
    visualizationController.abort();
    visualization?.stop();
    onCaptureEnd?.();
  };
  const detach = () => {
    clearTimeout(timer);
    endCapture();
    recognition.onstart = null;
    recognition.onaudioend = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  };
  const fail = (error) => {
    if (!active) return;
    active = false;
    detach();
    recognition.abort();
    if (error.error !== "aborted") onError(speechFailure(error));
    onEnd();
  };
  const stop = () => {
    if (!active || stopping) return;
    stopping = true;
    clearTimeout(timer);
    endCapture();
    try {
      recognition.stop();
    } catch (error) {
      fail(error);
    }
  };
  recognition.onstart = () => {
    if (!active || stopping) return;
    // Count the recording limit from actual listening, after permission prompts.
    timer = setTimeout(stop, 60_000);
    onStart?.();
    if (onAudioSource) {
      void startMicrophoneVisualization({
        signal: visualizationController.signal,
        onAudioSource: (analyser) => { if (active && !stopping) onAudioSource(analyser); },
      }).then((monitor) => {
        if (!active || stopping) monitor?.stop();
        else visualization = monitor;
      });
    }
  };
  recognition.onaudioend = endCapture;
  recognition.onresult = (event) => {
    if (!active) return;
    const interim = [];
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) onText(result[0].transcript);
      else interim.push(result[0].transcript);
    }
    onInterim?.(interim.join(" "));
  };
  recognition.onerror = fail;
  recognition.onend = () => {
    if (!active) return;
    active = false;
    detach();
    onEnd();
  };
  try {
    recognition.start();
  } catch (error) {
    active = false;
    detach();
    recognition.abort();
    throw speechFailure(error);
  }
  return {
    stop,
    abort() {
      if (!active) return;
      active = false;
      detach();
      recognition.abort();
    },
  };
}
