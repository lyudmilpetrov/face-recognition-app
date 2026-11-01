import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import VoiceTranslation from "./VoiceTranslation.jsx";

const { supportsModelSpeech, prepareSpeechModel, startModelSpeech } = vi.hoisted(() => ({
  supportsModelSpeech: vi.fn(), prepareSpeechModel: vi.fn(), startModelSpeech: vi.fn(),
}));

vi.mock("../services/localSpeechRecognition.js", async (importOriginal) => ({
  ...await importOriginal(), supportsModelSpeech, prepareSpeechModel, startModelSpeech,
}));

let translator;
let translatorApi;
let recognitions;
let Recognition;

beforeEach(() => {
  supportsModelSpeech.mockReturnValue(false);
  prepareSpeechModel.mockReset();
  startModelSpeech.mockReset();
  translator = { translate: vi.fn().mockResolvedValue("Hola mundo"), destroy: vi.fn() };
  translatorApi = { availability: vi.fn().mockResolvedValue("available"), create: vi.fn().mockResolvedValue(translator) };
  vi.stubGlobal("Translator", translatorApi);
  recognitions = [];
  Recognition = class {
    static available = vi.fn().mockResolvedValue("available");
    static install = vi.fn().mockResolvedValue(true);
    constructor() {
      this.start = vi.fn(() => this.onstart?.());
      this.abort = vi.fn();
      this.stop = vi.fn(() => this.onend?.());
      recognitions.push(this);
    }
  };
  Recognition.prototype.processLocally = false;
  vi.stubGlobal("SpeechRecognition", Recognition);
});

afterEach(() => vi.unstubAllGlobals());

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function speech(recognition, transcript, isFinal = true) {
  const result = Object.assign([{ transcript }], { isFinal });
  recognition.onresult({ resultIndex: 0, results: [result] });
}

async function start(user) {
  const button = screen.getByRole("button", { name: "Start microphone" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await screen.findByRole("button", { name: "Stop microphone" });
  return recognitions.at(-1);
}

test("offers an honest typed fallback when local speech and translation APIs are unavailable", async () => {
  vi.stubGlobal("Translator", undefined);
  vi.stubGlobal("SpeechRecognition", undefined);
  render(<VoiceTranslation />);
  expect(await screen.findByText(/This browser has no on-device Translator API/)).toBeInTheDocument();
  expect(await screen.findByText(/On-device speech recognition is unavailable for this browser/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start microphone" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Text to translate"), { target: { value: "Hello world" } });
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Hello world");
  expect(screen.getByRole("button", { name: "Translate text" })).toBeDisabled();
  expect(translatorApi.create).not.toHaveBeenCalled();
});

test("prepares and translates typed text in one action even without speech support, and releases the model on leave", async () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  const user = userEvent.setup();
  const { unmount } = render(<VoiceTranslation />);
  expect(translatorApi.create).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Text to translate"), "Hello world");
  await user.click(screen.getByRole("button", { name: "Translate text" }));
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  expect(translator.translate).toHaveBeenCalledWith("Hello world", { signal: expect.any(AbortSignal) });
  unmount();
  expect(translator.destroy).toHaveBeenCalledOnce();
});

test("Start microphone prepares local translation and automatically translates finalized speech while still recording", async () => {
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const recognition = await start(user);
  expect(translatorApi.create).toHaveBeenCalledOnce();
  expect(recognition.processLocally).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent("Listening");
  act(() => speech(recognition, "Hello", false));
  expect(screen.getByText("Hearing: Hello")).toBeInTheDocument();
  expect(translator.translate).not.toHaveBeenCalled();
  act(() => speech(recognition, "Hello world"));
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Hello world");
  expect(translator.translate).toHaveBeenCalledWith("Hello world", { signal: expect.any(AbortSignal) });
  expect(screen.getByRole("button", { name: "Stop microphone" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Stop microphone" }));
  expect(recognition.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("Translation complete");
});

test("a single click starts both downloads before awaiting them and then opens the microphone", async () => {
  const model = deferred();
  const pack = deferred();
  translatorApi.availability.mockResolvedValue("downloadable");
  translatorApi.create.mockReturnValue(model.promise);
  Recognition.available.mockResolvedValue("downloadable");
  Recognition.install.mockReturnValue(pack.promise);
  render(<VoiceTranslation />);
  const button = screen.getByRole("button", { name: "Start microphone" });
  await waitFor(() => expect(button).toBeEnabled());
  expect(Recognition.install).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(translatorApi.create).toHaveBeenCalledOnce();
  expect(Recognition.install).toHaveBeenCalledWith({ langs: ["en-US"], processLocally: true });
  expect(recognitions).toHaveLength(0);
  expect(screen.getByLabelText("Source language")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Starting microphone..." })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Starting microphone..." }));
  expect(translatorApi.create).toHaveBeenCalledOnce();
  await act(async () => model.resolve(translator));
  expect(recognitions).toHaveLength(0);
  await act(async () => pack.resolve(true));
  expect(recognitions).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Stop microphone" })).toBeEnabled();
});

test("cancels model preparation and destroys a late translator without starting the microphone", async () => {
  const model = deferred();
  translatorApi.create.mockReturnValue(model.promise);
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const button = screen.getByRole("button", { name: "Start microphone" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const signal = translatorApi.create.mock.calls[0][0].signal;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  await act(async () => model.resolve(translator));
  expect(translator.destroy).toHaveBeenCalledOnce();
  expect(recognitions).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Start microphone" })).toBeEnabled();
});

test("cancelling a pending speech download prevents a late install from opening the microphone", async () => {
  const pack = deferred();
  Recognition.available.mockResolvedValue("downloadable");
  Recognition.install.mockReturnValue(pack.promise);
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const button = screen.getByRole("button", { name: "Start microphone" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => pack.resolve(true));
  expect(translator.destroy).toHaveBeenCalledOnce();
  expect(recognitions).toHaveLength(0);
});

test("ignores typed translation results returned after cancellation and keeps the text", async () => {
  const result = deferred();
  translator.translate.mockReturnValue(result.promise);
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  await user.type(screen.getByLabelText("Text to translate"), "Hello");
  await user.click(screen.getByRole("button", { name: "Translate text" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => result.resolve("Late translation"));
  expect(screen.queryByText("Late translation")).not.toBeInTheDocument();
  expect(translator.destroy).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Hello");
});

test("serializes live translations and skips stale output when more speech arrives before a result", async () => {
  const first = deferred();
  const latest = deferred();
  translator.translate.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const recognition = await start(user);
  act(() => speech(recognition, "Hello"));
  act(() => speech(recognition, "world"));
  expect(translator.translate).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Stop microphone" }));
  expect(screen.getByRole("status")).toHaveTextContent("Finishing your translation");
  await act(async () => first.resolve("Stale result"));
  expect(screen.queryByText("Stale result")).not.toBeInTheDocument();
  expect(translator.translate).toHaveBeenLastCalledWith("Hello world", { signal: expect.any(AbortSignal) });
  await act(async () => latest.resolve("Hola mundo"));
  expect(screen.getByText("Hola mundo")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Translation complete");
  expect(screen.getByRole("button", { name: "Start microphone" })).toBeEnabled();
});

test("automatically finishes translation when recognition ends immediately after its final result", async () => {
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const recognition = await start(user);
  act(() => {
    speech(recognition, "Hello world");
    recognition.onend();
  });
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Hello world");
  expect(screen.getByRole("status")).toHaveTextContent("Translation complete");
});

test("clears old typed text and does not translate it when a recording captures no speech", async () => {
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  await user.type(screen.getByLabelText("Text to translate"), "Existing text");
  const recognition = await start(user);
  act(() => recognition.onend());
  expect(translator.translate).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("No speech was captured");
  expect(screen.getByLabelText("Text to translate")).toHaveValue("");
});

test("keeps microphone permission errors visible after recognition ends and allows retry", async () => {
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const recognition = await start(user);
  act(() => recognition.onerror({ error: "not-allowed", message: "private browser details" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Allow microphone access");
  expect(screen.getByRole("alert")).not.toHaveTextContent("private browser details");
  expect(screen.getByRole("status")).not.toHaveTextContent("Translation complete");
  await start(user);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(translatorApi.create).toHaveBeenCalledOnce();
});

test("aborts an active microphone and ignores a pending automatic translation when cancelled", async () => {
  const result = deferred();
  translator.translate.mockReturnValue(result.promise);
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const recognition = await start(user);
  act(() => speech(recognition, "Hello"));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => result.resolve("Late voice translation"));
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(recognition.onresult).toBeNull();
  expect(screen.queryByText("Late voice translation")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Hello");
});

test("aborts recording and destroys the translator when leaving the page", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<VoiceTranslation />);
  const recognition = await start(user);
  unmount();
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(recognition.onresult).toBeNull();
  expect(translator.destroy).toHaveBeenCalledOnce();
});

test("leaving during preparation destroys a late model without ever opening the microphone", async () => {
  const model = deferred();
  translatorApi.create.mockReturnValue(model.promise);
  const user = userEvent.setup();
  const { unmount } = render(<VoiceTranslation />);
  const button = screen.getByRole("button", { name: "Start microphone" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  unmount();
  await act(async () => model.resolve(translator));
  expect(translator.destroy).toHaveBeenCalledOnce();
  expect(recognitions).toHaveLength(0);
});

test("retains successful model preparation if a speech download needs another user action", async () => {
  Recognition.available.mockResolvedValue("downloadable");
  Recognition.install.mockRejectedValueOnce(new DOMException("internal details", "NotAllowedError")).mockResolvedValue(true);
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const button = screen.getByRole("button", { name: "Start microphone" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("press Start microphone again");
  expect(recognitions).toHaveLength(0);
  await start(user);
  expect(translatorApi.create).toHaveBeenCalledOnce();
  expect(Recognition.install).toHaveBeenCalledTimes(2);
});

test("changing languages releases the previous translator and prepares the new pair automatically", async () => {
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  await start(user);
  await user.click(screen.getByRole("button", { name: "Stop microphone" }));
  await user.selectOptions(screen.getByLabelText("Target language"), "fr");
  expect(translator.destroy).toHaveBeenCalledOnce();
  await start(user);
  expect(translatorApi.create).toHaveBeenLastCalledWith(expect.objectContaining({ sourceLanguage: "en", targetLanguage: "fr" }));
});

test("a live translation failure releases resources and retains the transcript for retry", async () => {
  translator.translate.mockRejectedValueOnce(new Error("private implementation"));
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const recognition = await start(user);
  act(() => speech(recognition, "Hello"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to translate locally");
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(translator.destroy).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Hello");
  await user.click(screen.getByRole("button", { name: "Translate text" }));
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  expect(translatorApi.create).toHaveBeenCalledTimes(2);
});

test("stops recording at the text limit and translates the bounded transcript", async () => {
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  const recognition = await start(user);
  act(() => speech(recognition, "a".repeat(5010)));
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  expect(screen.getByLabelText("Text to translate")).toHaveValue("a".repeat(5000));
  expect(recognition.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("5,000-character limit reached");
  expect(screen.getByRole("button", { name: "Start microphone" })).toBeEnabled();
});

test("starts every recording with an empty transcript and translation without appending the previous session", async () => {
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  expect(screen.getByRole("group", { name: "Microphone status" })).toHaveTextContent("Idle");
  const first = await start(user);
  act(() => speech(first, "First recording"));
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Stop microphone" }));
  expect(screen.getByRole("group", { name: "Microphone status" })).toHaveTextContent("Stopped");
  const second = await start(user);
  expect(screen.getByLabelText("Text to translate")).toHaveValue("");
  expect(screen.queryByText("Hola mundo")).not.toBeInTheDocument();
  act(() => speech(second, "Second recording"));
  await screen.findByText("Hola mundo");
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Second recording");
  expect(translator.translate).toHaveBeenLastCalledWith("Second recording", { signal: expect.any(AbortSignal) });
  expect(translatorApi.create).toHaveBeenCalledOnce();
});

test("clears an old translation immediately on Start even while microphone setup is pending", async () => {
  const pack = deferred();
  Recognition.available.mockResolvedValue("downloadable");
  Recognition.install.mockReturnValue(pack.promise);
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  await user.type(screen.getByLabelText("Text to translate"), "Previous text");
  await user.click(screen.getByRole("button", { name: "Translate text" }));
  await screen.findByText("Hola mundo");
  await user.click(screen.getByRole("button", { name: "Start microphone" }));
  expect(screen.getByLabelText("Text to translate")).toHaveValue("");
  expect(screen.queryByText("Hola mundo")).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Microphone status" })).not.toHaveTextContent("Listening");
  await act(async () => pack.resolve(true));
  await screen.findByRole("button", { name: "Stop microphone" });
  expect(screen.getByRole("group", { name: "Microphone status" })).toHaveTextContent("Listening");
});

test("allows a fresh recording when the previous transcript has reached the character limit", async () => {
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  fireEvent.change(screen.getByLabelText("Text to translate"), { target: { value: "a".repeat(5000) } });
  const recognition = await start(user);
  expect(screen.getByLabelText("Text to translate")).toHaveValue("");
  act(() => speech(recognition, "Fresh phrase"));
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  expect(translator.translate).toHaveBeenCalledWith("Fresh phrase", { signal: expect.any(AbortSignal) });
});

test("starts the local model fallback and automatically translates its transcript in browsers without native local speech", async () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  supportsModelSpeech.mockReturnValue(true);
  const model = { transcribe: vi.fn(), dispose: vi.fn() };
  prepareSpeechModel.mockResolvedValue(model);
  const recording = { stop: vi.fn(), abort: vi.fn() };
  let callbacks;
  startModelSpeech.mockImplementation(async (_language, options) => {
    callbacks = options;
    options.onStart();
    return recording;
  });
  const user = userEvent.setup();
  const { unmount } = render(<VoiceTranslation />);
  await screen.findByText(/Your browser will use a local speech model/);
  expect(prepareSpeechModel).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Start microphone" }));
  await screen.findByRole("button", { name: "Stop microphone" });
  expect(startModelSpeech).toHaveBeenCalledWith("en-US", expect.objectContaining({ transcriber: model, signal: expect.any(AbortSignal) }));
  act(() => callbacks.onText("Hello world"));
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Hello world");
  await user.click(screen.getByRole("button", { name: "Stop microphone" }));
  expect(recording.stop).toHaveBeenCalledOnce();
  act(() => callbacks.onEnd());
  expect(screen.getByRole("status")).toHaveTextContent("Translation complete");
  unmount();
  expect(model.dispose).toHaveBeenCalledOnce();
});

test("cancelling model fallback preparation disposes the late model without opening the microphone", async () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  supportsModelSpeech.mockReturnValue(true);
  const pending = deferred();
  const model = { dispose: vi.fn() };
  prepareSpeechModel.mockReturnValue(pending.promise);
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  await screen.findByText(/Your browser will use a local speech model/);
  await user.click(screen.getByRole("button", { name: "Start microphone" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => pending.resolve(model));
  expect(model.dispose).toHaveBeenCalledOnce();
  expect(startModelSpeech).not.toHaveBeenCalled();
});

test("shows Stopped as soon as model capture ends while the final transcription and translation still finish", async () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  supportsModelSpeech.mockReturnValue(true);
  prepareSpeechModel.mockResolvedValue({ transcribe: vi.fn(), dispose: vi.fn() });
  let callbacks;
  startModelSpeech.mockImplementation(async (_language, options) => {
    callbacks = options;
    options.onStart();
    return { stop: vi.fn(), abort: vi.fn() };
  });
  const user = userEvent.setup();
  render(<VoiceTranslation />);
  await screen.findByText(/Your browser will use a local speech model/);
  await user.click(screen.getByRole("button", { name: "Start microphone" }));
  await screen.findByRole("button", { name: "Stop microphone" });
  expect(screen.getByRole("group", { name: "Microphone status" })).toHaveTextContent("Listening");
  act(() => callbacks.onCaptureEnd());
  expect(screen.getByRole("group", { name: "Microphone status" })).toHaveTextContent("Stopped");
  expect(screen.queryByRole("button", { name: "Stop microphone" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start microphone" })).toBeDisabled();
  act(() => callbacks.onText("Final phrase"));
  expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
  act(() => callbacks.onEnd());
  expect(screen.getByRole("button", { name: "Start microphone" })).toBeEnabled();
  expect(screen.getByRole("group", { name: "Microphone status" })).toHaveTextContent("Stopped");
  expect(screen.getByLabelText("Text to translate")).toHaveValue("Final phrase");
});
