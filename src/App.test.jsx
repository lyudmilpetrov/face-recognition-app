import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import mainReducer from "./slice/main-slice";

const { toastError, toastMessage, toastPromise, startRecognition, stopRecognition } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastMessage: vi.fn(),
  toastPromise: vi.fn(),
  startRecognition: vi.fn(),
  stopRecognition: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  Toaster: () => null,
  toast: Object.assign(toastMessage, { error: toastError, promise: toastPromise }),
}));

vi.mock("./modules/icon", () => ({ default: () => null }));

vi.mock("./Components/FaceRecognitionBlaze", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");

  const MockFaceRecognition = forwardRef(function MockFaceRecognition(
    { videoId, onRecognitionError },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      startFaceRecognition: () => startRecognition(videoId),
      stopFaceRecognition: () => stopRecognition(videoId),
    }));

    return <video data-testid={videoId} onError={onRecognitionError} />;
  });

  return { default: MockFaceRecognition };
});

async function renderApp() {
  const initialMainState = mainReducer(undefined, { type: "@@INIT" });
  const store = configureStore({
    reducer: { main: mainReducer },
    preloadedState: { main: { ...initialMainState, theme: "light" } },
  });
  const user = userEvent.setup();

  render(
    <Provider store={store}>
      <App />
    </Provider>
  );

  await screen.findByRole("button", { name: "Stop Recognition 1" });
  await screen.findByRole("button", { name: "Stop Recognition 2" });

  return { user, store };
}

beforeEach(() => {
  vi.clearAllMocks();
  startRecognition.mockReset().mockResolvedValue();
  stopRecognition.mockReset().mockReturnValue(null);
  toastPromise.mockImplementation((promise) => promise);
  vi.spyOn(console, "log").mockImplementation(() => {});
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

test("renders both camera panels and the voice capture controls", async () => {
  await renderApp();

  expect(screen.getByText("Face Recognitions Demos")).toBeInTheDocument();
  expect(screen.getByTestId("video1")).toBeInTheDocument();
  expect(screen.getByTestId("video2")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Voice Capture" })).toBeInTheDocument();
  expect(screen.getByText("Status: Idle")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start Voice Capture" })).toBeEnabled();
});

test("updates Redux, the document theme, and the saved preference", async () => {
  const { user, store } = await renderApp();

  await user.click(screen.getByRole("button", { name: "Toggle color theme" }));

  expect(store.getState().main.theme).toBe("dark");
  expect(document.documentElement).toHaveClass("dark");
  expect(window.localStorage.getItem("theme")).toBe("dark");

  await user.click(screen.getByRole("button", { name: "Toggle color theme" }));

  expect(store.getState().main.theme).toBe("light");
  expect(document.documentElement).not.toHaveClass("dark");
  expect(window.localStorage.getItem("theme")).toBe("light");
});

test("explains that both face detections must finish before comparison", async () => {
  const { user } = await renderApp();

  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(toastError).toHaveBeenCalledWith(
    "Finish both detections first, then press Stop Recognition on each video to capture results."
  );
  expect(toastPromise).not.toHaveBeenCalled();
});

test.each([
  { secondFace: { topLeft: [10, 10], bottomRight: [110, 110] }, expected: "Strong match: 100.0% similarity." },
  { secondFace: { topLeft: [300, 300], bottomRight: [400, 400] }, expected: "Low match: 0.0% similarity." },
])("compares stopped face-box geometry and displays $expected", async ({ secondFace, expected }) => {
  const firstFace = { topLeft: [10, 10], bottomRight: [110, 110] };
  stopRecognition.mockImplementation((videoId) => [videoId === "video1" ? firstFace : secondFace]);
  const { user } = await renderApp();

  await user.click(screen.getByRole("button", { name: "Stop Recognition 1" }));
  await user.click(screen.getByRole("button", { name: "Stop Recognition 2" }));
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(toastMessage).toHaveBeenCalledWith(expected, expect.any(Object));
  expect(toastError).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(
    "[FaceComparison] Step 6: Display the frame-geometry result. This score does not establish identity."
  );
  // Process explanations must never include captured pixels or prediction data.
  expect(console.log.mock.calls.every((args) => args.every((value) => typeof value === "string"))).toBe(true);
});

test("requires a detected face in each stopped capture", async () => {
  stopRecognition.mockReturnValue([]);
  const { user } = await renderApp();

  await user.click(screen.getByRole("button", { name: "Stop Recognition 1" }));
  await user.click(screen.getByRole("button", { name: "Stop Recognition 2" }));
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(toastError).toHaveBeenCalledWith(
    "Finish both detections first, then press Stop Recognition on each video to capture results."
  );
  expect(toastPromise).not.toHaveBeenCalled();
});

test("restarting a camera invalidates its previous stopped capture", async () => {
  stopRecognition.mockReturnValue([{ topLeft: [10, 10], bottomRight: [110, 110] }]);
  const { user } = await renderApp();

  await user.click(screen.getByRole("button", { name: "Stop Recognition 1" }));
  await user.click(screen.getByRole("button", { name: "Stop Recognition 2" }));
  await user.click(screen.getByRole("button", { name: "Start Recognition 1" }));
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(toastError).toHaveBeenCalledWith(
    "Finish both detections first, then press Stop Recognition on each video to capture results."
  );
  expect(toastPromise).not.toHaveBeenCalled();
});

test("handles a camera restart failure and allows retry", async () => {
  const { user } = await renderApp();
  await user.click(screen.getByRole("button", { name: "Stop Recognition 1" }));
  startRecognition.mockRejectedValueOnce(new Error("Private camera diagnostic"));

  await user.click(screen.getByRole("button", { name: "Start Recognition 1" }));

  expect(toastError).toHaveBeenCalledWith(
    "Unable to start face detection. Please check camera permissions and try again."
  );
  expect(screen.getByRole("button", { name: "Start Recognition 1" })).toBeEnabled();
});

test("a pending auto-start cannot switch a stopped camera back to running", async () => {
  let resolveStartup;
  const pendingStartup = new Promise((resolve) => {
    resolveStartup = resolve;
  });
  startRecognition.mockReturnValueOnce(pendingStartup);
  const { user } = await renderApp();

  await user.click(screen.getByRole("button", { name: "Stop Recognition 1" }));
  expect(screen.getByRole("button", { name: "Start Recognition 1" })).toBeEnabled();
  await act(async () => {
    resolveStartup();
    await pendingStartup;
  });

  expect(screen.getByRole("button", { name: "Start Recognition 1" })).toBeEnabled();
});

test("shows that recognition stopped when a later detection fails", async () => {
  await renderApp();

  fireEvent.error(screen.getByTestId("video1"));

  expect(toastError).toHaveBeenCalledWith(
    "Face detection stopped. Please start recognition again."
  );
  expect(screen.getByRole("button", { name: "Start Recognition 1" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Stop Recognition 2" })).toBeEnabled();
});

test("keeps voice capture idle when speech recognition is unsupported", async () => {
  const { user } = await renderApp();

  await user.click(screen.getByRole("button", { name: "Start Voice Capture" }));

  expect(toastError).toHaveBeenCalledWith(
    "Voice capture is not supported in this browser."
  );
  expect(screen.getByText("Status: Idle")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start Voice Capture" })).toBeEnabled();
});
