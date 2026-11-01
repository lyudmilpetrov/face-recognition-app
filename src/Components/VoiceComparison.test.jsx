import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import VoiceComparison from "./VoiceComparison.jsx";

const { compare, dispose, createClient } = vi.hoisted(() => ({
  compare: vi.fn(),
  dispose: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("../voice/voiceComparisonClient.js", () => ({
  createVoiceComparisonClient: createClient,
  getVoiceErrorMessage: () => "Unable to compare these recordings. Please try again.",
}));

let getUserMedia;
let trackStops;
let recorders;
let createObjectURL;
let revokeObjectURL;
let mediaDevicesDescriptor;

function streamWithStop() {
  const stop = vi.fn();
  trackStops.push(stop);
  return { getTracks: () => [{ stop }] };
}

async function uploadBoth(user) {
  await user.upload(screen.getByLabelText("Upload reference voice"), new File(["reference audio"], "reference.wav", { type: "audio/wav" }));
  await user.upload(screen.getByLabelText("Upload test voice"), new File(["test audio"], "test.wav", { type: "audio/wav" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  compare.mockReset().mockResolvedValue(0.812);
  dispose.mockReset();
  createClient.mockReset().mockReturnValue({ compare, dispose });
  trackStops = [];
  recorders = [];
  getUserMedia = vi.fn().mockImplementation(async () => streamWithStop());
  mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  createObjectURL = vi.fn().mockImplementation((blob) => `blob:test-${blob.size}-${createObjectURL.mock.calls.length}`);
  revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported(type) { return type === "audio/webm;codecs=opus"; }
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options?.mimeType || "audio/webm";
      this.state = "inactive";
      recorders.push(this);
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["recorded speech"], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  else delete navigator.mediaDevices;
});

test("records reference and test voices, releases the microphone, and compares their audio", async () => {
  const user = userEvent.setup();
  render(<VoiceComparison />);
  expect(screen.getByRole("button", { name: "Compare Voices" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Record reference voice" }));
  expect(screen.getByRole("button", { name: "Record test voice" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Stop recording" }));
  expect(await screen.findByLabelText("Reference voice playback")).toBeInTheDocument();
  expect(trackStops[0]).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "Record test voice" }));
  await user.click(screen.getByRole("button", { name: "Stop recording" }));
  expect(await screen.findByLabelText("Test voice playback")).toBeInTheDocument();
  expect(trackStops[1]).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Compare Voices" }));

  expect(compare).toHaveBeenCalledWith(expect.any(Blob), expect.any(Blob), expect.any(Function));
  expect(await screen.findByText("0.812")).toBeInTheDocument();
  expect(screen.getByText(/not a probability or proof of identity/)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Comparison complete.");
});

test("allows uploads when microphone recording is unsupported", async () => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  const user = userEvent.setup();
  render(<VoiceComparison />);

  await user.click(screen.getByRole("button", { name: "Record reference voice" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Microphone recording is unavailable");
  await uploadBoth(user);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare Voices" })).toBeEnabled();
});

test("explains denied permission safely and permits retry", async () => {
  getUserMedia.mockRejectedValueOnce(new DOMException("Private device diagnostic", "NotAllowedError"));
  const user = userEvent.setup();
  render(<VoiceComparison />);

  await user.click(screen.getByRole("button", { name: "Record reference voice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Microphone permission was denied");
  expect(screen.queryByText(/Private device diagnostic/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Record reference voice" }));
  expect(screen.getByRole("button", { name: "Stop recording" })).toBeEnabled();
});

test("re-recording invalidates a prior comparison and revokes its old playback URL", async () => {
  const user = userEvent.setup();
  render(<VoiceComparison />);
  await uploadBoth(user);
  const previousUrl = screen.getByLabelText("Reference voice playback").getAttribute("src");
  await user.click(screen.getByRole("button", { name: "Compare Voices" }));
  expect(await screen.findByText("0.812")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Re-record reference voice" }));
  expect(screen.queryByText("0.812")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare Voices" })).toBeDisabled();
  expect(revokeObjectURL).toHaveBeenCalledWith(previousUrl);
});

test("cancels comparison and ignores late progress and results", async () => {
  let finishComparison;
  compare.mockImplementationOnce(() => new Promise((resolve) => { finishComparison = resolve; }));
  const user = userEvent.setup();
  render(<VoiceComparison />);
  await uploadBoth(user);
  await user.click(screen.getByRole("button", { name: "Compare Voices" }));
  expect(screen.getByRole("button", { name: "Comparing voices..." })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Cancel comparison" }));
  expect(dispose).toHaveBeenCalledOnce();
  await act(async () => {
    compare.mock.calls[0][2]("Late progress");
    finishComparison(0.999);
  });

  expect(screen.queryByText("0.999")).not.toBeInTheDocument();
  expect(screen.queryByText("Late progress")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare Voices" })).toBeEnabled();
});

test("shows a safe comparison error and enables another attempt", async () => {
  compare.mockRejectedValueOnce(new Error("Internal model stack trace"));
  const user = userEvent.setup();
  render(<VoiceComparison />);
  await uploadBoth(user);
  await user.click(screen.getByRole("button", { name: "Compare Voices" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to compare these recordings. Please try again.");
  expect(screen.queryByText(/Internal model stack trace/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare Voices" })).toBeEnabled();
});

test("rejects empty and oversized uploads before creating a playback URL", async () => {
  const user = userEvent.setup();
  render(<VoiceComparison />);
  const tooLarge = new File(["audio"], "large.wav", { type: "audio/wav" });
  Object.defineProperty(tooLarge, "size", { value: 20 * 1024 * 1024 + 1 });

  await user.upload(screen.getByLabelText("Upload reference voice"), tooLarge);
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a non-empty audio file up to 20 MB.");
  await user.upload(screen.getByLabelText("Upload reference voice"), new File([], "empty.wav", { type: "audio/wav" }));
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Compare Voices" })).toBeDisabled();
});

test("stops an active microphone and releases playback URLs on unmount", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<VoiceComparison />);
  await uploadBoth(user);
  await user.click(screen.getByRole("button", { name: "Re-record reference voice" }));
  unmount();

  expect(trackStops[0]).toHaveBeenCalledOnce();
  expect(recorders[0].state).toBe("inactive");
  expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});

test("releases microphone access that arrives after unmount", async () => {
  let grantPermission;
  getUserMedia.mockImplementationOnce(() => new Promise((resolve) => { grantPermission = resolve; }));
  const user = userEvent.setup();
  const { unmount } = render(<VoiceComparison />);
  await user.click(screen.getByRole("button", { name: "Record reference voice" }));
  expect(screen.getByRole("button", { name: "Cancel microphone request" })).toBeEnabled();
  unmount();
  await act(async () => { grantPermission(streamWithStop()); });

  expect(trackStops[0]).toHaveBeenCalledOnce();
  expect(recorders).toHaveLength(0);
});

test("cancels a pending microphone request and releases a late stream", async () => {
  let grantPermission;
  getUserMedia.mockImplementationOnce(() => new Promise((resolve) => { grantPermission = resolve; }));
  const user = userEvent.setup();
  render(<VoiceComparison />);
  await user.click(screen.getByRole("button", { name: "Record reference voice" }));
  await user.click(screen.getByRole("button", { name: "Cancel microphone request" }));
  await act(async () => { grantPermission(streamWithStop()); });

  expect(trackStops[0]).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Record reference voice" })).toBeEnabled();
  expect(recorders).toHaveLength(0);
});

test("automatically stops recording after 10 seconds", async () => {
  vi.useFakeTimers();
  render(<VoiceComparison />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Record reference voice" }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

  expect(screen.getByLabelText("Reference voice playback")).toBeInTheDocument();
  expect(trackStops[0]).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Record test voice" })).toBeEnabled();
});
