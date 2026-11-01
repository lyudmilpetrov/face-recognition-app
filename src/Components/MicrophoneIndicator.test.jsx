import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import MicrophoneIndicator from "./MicrophoneIndicator.jsx";

let drawing;
let frames;
let nextFrame;

beforeEach(() => {
  drawing = {
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(drawing);
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id) => frames.delete(id)));
});

afterEach(() => vi.unstubAllGlobals());

function advanceFrame() {
  const [id, callback] = frames.entries().next().value;
  frames.delete(id);
  act(() => callback());
}

test("distinguishes idle, starting, listening, and stopped states accessibly", () => {
  const { rerender } = render(<MicrophoneIndicator state="idle" />);
  expect(screen.getByRole("group", { name: "Microphone status" })).toHaveTextContent("Idle");
  expect(screen.getByText(/Press Start microphone to begin/)).toBeInTheDocument();
  rerender(<MicrophoneIndicator state="starting" />);
  expect(screen.getByText("Starting microphone…")).toBeInTheDocument();
  expect(screen.getByText(/Allow access if your browser asks/)).toBeInTheDocument();
  rerender(<MicrophoneIndicator state="listening" />);
  expect(screen.getByText("Listening")).toBeInTheDocument();
  expect(screen.getByText(/Microphone is active/)).toBeInTheDocument();
  rerender(<MicrophoneIndicator state="stopped" />);
  expect(screen.getByText("Stopped")).toBeInTheDocument();
  expect(screen.getByText(/The microphone is off/)).toBeInTheDocument();
});

test("shows listening immediately without inventing a waveform when no analyser is available", () => {
  const { container } = render(<MicrophoneIndicator state="listening" analyser={null} />);
  expect(screen.getByText("Listening")).toBeInTheDocument();
  expect(screen.getByText(/Microphone is active/)).toBeInTheDocument();
  expect(container.querySelector("canvas")).toBeNull();
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});

test("draws a flat line for silence and changes the waveform only when microphone samples change", () => {
  let audible = false;
  const analyser = {
    fftSize: 8,
    getByteTimeDomainData: vi.fn((samples) => {
      samples.fill(128);
      if (audible) { samples[2] = 64; samples[3] = 192; }
    }),
  };
  render(<MicrophoneIndicator state="listening" analyser={analyser} />);
  const center = drawing.moveTo.mock.calls[0][1];
  expect(drawing.lineTo.mock.calls.every(([, y]) => y === center)).toBe(true);
  drawing.lineTo.mockClear();
  advanceFrame();
  expect(drawing.lineTo.mock.calls.every(([, y]) => y === center)).toBe(true);

  drawing.lineTo.mockClear();
  audible = true;
  advanceFrame();
  const values = drawing.lineTo.mock.calls.map(([, y]) => y);
  expect(values.some((y) => y < center)).toBe(true);
  expect(values.some((y) => y > center)).toBe(true);
  expect(analyser.getByteTimeDomainData).toHaveBeenCalledTimes(3);
});

test("stops sampling and cancels the pending frame when recording stops", () => {
  const analyser = { fftSize: 8, getByteTimeDomainData: vi.fn((samples) => samples.fill(128)) };
  const { rerender, container } = render(<MicrophoneIndicator state="listening" analyser={analyser} />);
  const pending = [...frames.values()][0];
  rerender(<MicrophoneIndicator state="stopped" analyser={analyser} />);
  expect(cancelAnimationFrame).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  expect(container.querySelector("canvas")).toBeNull();
  act(() => pending());
  expect(analyser.getByteTimeDomainData).toHaveBeenCalledOnce();
});

test("fits the waveform to its displayed size at the device pixel ratio", () => {
  vi.stubGlobal("devicePixelRatio", 2);
  const analyser = { fftSize: 8, getByteTimeDomainData: vi.fn((samples) => samples.fill(128)) };
  const { container } = render(<MicrophoneIndicator state="listening" analyser={analyser} />);
  const canvas = container.querySelector("canvas");
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, value: 320 },
    clientHeight: { configurable: true, value: 64 },
  });
  advanceFrame();
  expect(canvas.width).toBe(640);
  expect(canvas.height).toBe(128);
  expect(drawing.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  expect(drawing.lineTo).toHaveBeenLastCalledWith(320, 32);
});

test("releases the old frame when the analyser changes and cancels drawing on unmount", () => {
  const first = { fftSize: 8, getByteTimeDomainData: vi.fn((samples) => samples.fill(128)) };
  const second = { fftSize: 8, getByteTimeDomainData: vi.fn((samples) => samples.fill(160)) };
  const { rerender, unmount } = render(<MicrophoneIndicator state="listening" analyser={first} />);
  rerender(<MicrophoneIndicator state="listening" analyser={second} />);
  expect(first.getByteTimeDomainData).toHaveBeenCalledOnce();
  expect(second.getByteTimeDomainData).toHaveBeenCalledOnce();
  expect(frames.size).toBe(1);
  const pending = [...frames.values()][0];
  unmount();
  expect(cancelAnimationFrame).toHaveBeenCalledTimes(2);
  expect(frames.size).toBe(0);
  act(() => pending());
  expect(second.getByteTimeDomainData).toHaveBeenCalledOnce();
});
