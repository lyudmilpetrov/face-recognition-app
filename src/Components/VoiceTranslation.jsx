import { useEffect, useId, useRef, useState } from "react";
import MicrophoneIndicator from "./MicrophoneIndicator.jsx";
import {
  TRANSLATION_LANGUAGES,
  getSpeechAvailability,
  getTranslationAvailability,
  getTranslationErrorMessage,
  prepareLocalSpeech,
  prepareLocalTranslator,
  translateLocalText,
} from "../services/voiceTranslation.js";

const buttonClasses = "inline-flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400";
const secondaryClasses = "inline-flex items-center justify-center rounded-full border border-indigo-300 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-600 dark:text-indigo-200 dark:hover:bg-indigo-900/40";
const fieldClasses = "mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const usableAvailability = ["available", "downloadable", "downloading"];

export default function VoiceTranslation() {
  const id = useId();
  const [source, setSource] = useState("en");
  const [target, setTarget] = useState("es");
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");
  const [interim, setInterim] = useState("");
  const [translationAvailability, setTranslationAvailability] = useState("checking");
  const [speechAvailability, setSpeechAvailability] = useState("checking");
  const [phase, setPhase] = useState("idle");
  const [microphoneState, setMicrophoneState] = useState("idle");
  const [audioAnalyser, setAudioAnalyser] = useState(null);
  const [status, setStatus] = useState("Choose languages, then press Start microphone. Speech will be translated automatically.");
  const [error, setError] = useState("");
  const operationRef = useRef(null);
  const translatorRef = useRef(null);
  const speechRef = useRef(null);
  const speechInputRef = useRef(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const speechLanguage = TRANSLATION_LANGUAGES.find((language) => language.code === source).speech;
  const busy = phase !== "idle";
  const canTranslate = usableAvailability.includes(translationAvailability);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      operationRef.current?.abort();
      speechRef.current?.abort();
      speechInputRef.current?.dispose();
      speechInputRef.current = null;
      translatorRef.current?.destroy();
      translatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setTranslationAvailability("checking");
    setSpeechAvailability("checking");
    getTranslationAvailability(source, target).then((availability) => {
      if (current) setTranslationAvailability(availability);
    });
    getSpeechAvailability(speechLanguage).then((availability) => {
      if (current) setSpeechAvailability(availability);
    });
    return () => { current = false; };
  }, [source, target, speechLanguage]);

  const cancel = (message = "Cancelled. Your text is ready to edit.") => {
    generationRef.current += 1;
    operationRef.current?.abort();
    operationRef.current = null;
    speechRef.current?.abort();
    speechRef.current = null;
    speechInputRef.current?.dispose();
    speechInputRef.current = null;
    translatorRef.current?.destroy();
    translatorRef.current = null;
    setPhase("idle");
    setMicrophoneState((previous) => previous === "idle" ? "idle" : "stopped");
    setAudioAnalyser(null);
    setInterim("");
    setStatus(message);
    setError("");
  };

  const changeLanguage = (setter, value) => {
    cancel("Languages changed. Press Start microphone or translate your text.");
    setOutput("");
    setter(value);
  };

  const beginOperation = (nextPhase, message) => {
    const controller = new AbortController();
    operationRef.current = controller;
    const generation = ++generationRef.current;
    setPhase(nextPhase);
    setError("");
    setOutput("");
    setStatus(message);
    return {
      controller,
      current: () => mountedRef.current && generation === generationRef.current && !controller.signal.aborted,
    };
  };

  const getTranslator = async ({ controller, current }) => {
    if (translatorRef.current) return translatorRef.current;
    const translator = await prepareLocalTranslator(source, target, {
      signal: controller.signal,
      onProgress: (percentage) => {
        if (current()) setStatus(`Downloading translation models: ${percentage}%.`);
      },
    });
    if (!current()) {
      translator.destroy();
      return null;
    }
    translatorRef.current = translator;
    return translator;
  };

  const record = async () => {
    if (operationRef.current) return;
    const operation = beginOperation("starting", "Preparing speech and translation. Required language packs may download before the microphone starts...");
    setText("");
    setInterim("");
    setAudioAnalyser(null);
    setMicrophoneState("starting");
    const { controller, current } = operation;
    const session = { text: "", version: 0, translatedVersion: 0, translating: false, ended: false, failed: false };

    const stopListening = () => {
      if (!current()) return;
      setMicrophoneState("stopped");
      setAudioAnalyser(null);
    };

    const finish = () => {
      if (!current()) return;
      operationRef.current = null;
      setPhase("idle");
      setInterim("");
      stopListening();
      if (session.failed) setStatus("Microphone stopped. Your text is ready to edit and retry.");
      else if (!session.version) setStatus("No speech was captured. Press Start microphone and speak clearly.");
      else setStatus(session.text.length === 5000 ? "5,000-character limit reached. Translation complete. Start a new recording to continue." : "Microphone stopped. Translation complete.");
    };

    // Serialize translations and only display the latest complete transcript.
    // Speech can continue while an earlier translation is still running.
    const translateSpeech = async (translator) => {
      if (session.translating || !current()) return;
      session.translating = true;
      try {
        while (current() && session.translatedVersion < session.version) {
          const version = session.version;
          const result = await translateLocalText(translator, session.text, controller.signal);
          if (!current()) return;
          session.translatedVersion = version;
          if (version === session.version) setOutput(result);
        }
      } catch (failure) {
        if (!current()) return;
        session.failed = true;
        session.ended = true;
        speechRef.current?.abort();
        speechRef.current = null;
        stopListening();
        translatorRef.current?.destroy();
        translatorRef.current = null;
        setError(getTranslationErrorMessage(failure));
      } finally {
        session.translating = false;
        if (session.ended) finish();
      }
    };

    try {
      // Start both preparation calls from the click, before awaiting either,
      // so the browser can authorize any required on-device downloads.
      const translatorPromise = getTranslator(operation);
      const speechPromise = speechInputRef.current ? Promise.resolve(speechInputRef.current) : prepareLocalSpeech(speechLanguage, {
        availability: speechAvailability,
        signal: controller.signal,
        onProgress: (percentage) => {
          if (current()) setStatus(`Downloading local speech model: ${percentage}%. The microphone will start automatically when ready.`);
        },
      }).then((input) => {
        if (!current()) {
          input.dispose();
          return null;
        }
        speechInputRef.current = input;
        return input;
      });
      const [translation, speech] = await Promise.allSettled([translatorPromise, speechPromise]);
      if (!current()) return;
      if (translation.status === "rejected") throw translation.reason;
      if (speech.status === "rejected") throw speech.reason;
      setStatus("Waiting for microphone permission. Allow access in your browser to start speaking.");
      const recording = await speech.value.start({
        signal: controller.signal,
        onStart: () => {
          if (!current()) return;
          setPhase("recording");
          setMicrophoneState("listening");
          setStatus("Listening. Your speech is transcribed and translated automatically. Recording stops after one minute.");
        },
        onAudioSource: (analyser) => { if (current()) setAudioAnalyser(analyser); },
        onCaptureEnd: () => {
          stopListening();
          if (current() && !session.ended) setPhase("stopping");
        },
        onText: (transcript) => {
          if (!current() || session.failed || !transcript.trim()) return;
          session.text = `${session.text}${session.text ? " " : ""}${transcript.trim()}`.slice(0, 5000);
          session.version += 1;
          setText(session.text);
          setOutput("");
          void translateSpeech(translation.value);
          if (session.text.length === 5000) {
            stopListening();
            setPhase("stopping");
            speechRef.current?.stop();
          }
        },
        onInterim: (transcript) => { if (current()) setInterim(transcript); },
        onError: (failure) => {
          if (!current()) return;
          session.failed = true;
          setError(getTranslationErrorMessage(failure));
        },
        onEnd: () => {
          if (!current()) return;
          speechRef.current = null;
          session.ended = true;
          stopListening();
          setInterim("");
          if (session.translating) {
            setPhase("translating");
            setStatus("Microphone stopped. Finishing your translation...");
          } else finish();
        },
      });
      if (!current()) recording.abort();
      else speechRef.current = recording;
    } catch (failure) {
      if (!current()) return;
      session.failed = true;
      setError(getTranslationErrorMessage(failure));
      finish();
    }
  };

  const stopRecording = () => {
    setMicrophoneState("stopped");
    setAudioAnalyser(null);
    setPhase("stopping");
    setStatus("Stopping the microphone and finishing your transcript...");
    speechRef.current?.stop();
  };

  const translate = async () => {
    if (operationRef.current || !canTranslate || !text.trim()) return;
    const operation = beginOperation("translating", "Preparing and translating on your device...");
    try {
      const translator = await getTranslator(operation);
      if (!operation.current()) return;
      const result = await translateLocalText(translator, text, operation.controller.signal);
      if (!operation.current()) return;
      setOutput(result);
      setStatus("Translation complete.");
    } catch (failure) {
      if (operation.current()) {
        translatorRef.current?.destroy();
        translatorRef.current = null;
        setStatus("Translation stopped. Your text is ready to edit and retry.");
        setError(getTranslationErrorMessage(failure));
      }
    } finally {
      if (operation.current()) {
        operationRef.current = null;
        setPhase("idle");
      }
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
      <h2 id={`${id}-heading`} className="text-xl font-semibold">Voice Translation</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Choose your languages and press Start microphone. Your speech becomes text and is translated automatically as you speak.</p>
      <p id={`${id}-privacy`} className="mt-2 text-xs text-slate-500 dark:text-slate-400">Speech and text are processed on your device and kept in memory. Starting may download language packs. No cloud recognition or translation fallback is used.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium" htmlFor={`${id}-source`}>Source language
          <select id={`${id}-source`} className={fieldClasses} value={source} disabled={busy} onChange={(event) => changeLanguage(setSource, event.target.value)}>
            {TRANSLATION_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium" htmlFor={`${id}-target`}>Target language
          <select id={`${id}-target`} className={fieldClasses} value={target} disabled={busy} onChange={(event) => changeLanguage(setTarget, event.target.value)}>
            {TRANSLATION_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
          </select>
        </label>
      </div>
      {translationAvailability === "unsupported" && <p className="mt-4 text-sm text-amber-800 dark:text-amber-200">This browser has no on-device Translator API. Try a supported desktop browser. You can still enter text here, but translation requires that API.</p>}
      {translationAvailability === "unavailable" && <p className="mt-4 text-sm text-amber-800 dark:text-amber-200">On-device translation is unavailable for these languages. Choose two different supported languages.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {phase === "recording" ? <button type="button" className={buttonClasses} onClick={stopRecording}>Stop microphone</button> : <button type="button" className={buttonClasses} aria-describedby={`${id}-privacy`} disabled={busy} onClick={record}>{phase === "starting" ? "Starting microphone..." : "Start microphone"}</button>}
        {busy && <button type="button" className={secondaryClasses} onClick={() => cancel()}>Cancel</button>}
      </div>
      <MicrophoneIndicator state={microphoneState} analyser={audioAnalyser} />
      {text.length === 5000 && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">The text has reached 5,000 characters. Start a new recording to begin with a fresh transcript.</p>}
      {["unsupported", "unavailable"].includes(speechAvailability) && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">On-device speech recognition is unavailable for this browser or language. Type your text below instead.</p>}
      {speechAvailability === "model" && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Your browser will use a local speech model. The first start downloads about 40 MB; speech stays on your device. Pause briefly between phrases for text and translation to appear.</p>}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <label htmlFor={`${id}-text`} className="text-sm font-medium">Text to translate</label>
          <textarea id={`${id}-text`} className={fieldClasses} rows={7} maxLength={5000} value={text} readOnly={busy} lang={source} onChange={(event) => { setText(event.target.value); setOutput(""); }} placeholder="Speak using Start microphone, or type here." />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{text.length} / 5,000 characters</p>
          {interim && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Hearing: {interim}</p>}
          <button type="button" className={`${secondaryClasses} mt-3`} disabled={busy || !canTranslate || !text.trim()} onClick={translate}>Translate text</button>
        </div>
        <div>
          <h3 id={`${id}-translation`} className="text-sm font-medium">Translation</h3>
          <div aria-labelledby={`${id}-translation`} className="mt-2 min-h-48 whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-600 dark:bg-slate-900" lang={target}>{output || "Your automatic translation will appear here."}</div>
        </div>
      </div>
      <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-300">{status}</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
}
