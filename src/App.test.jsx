import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import mainReducer from "./slice/main-slice";

const { toastError, toastMessage, toastPromise, startRecognition, stopRecognition, captureFrame, compareFaceImages, getFaceComparisonErrorMessage } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastMessage: vi.fn(),
  toastPromise: vi.fn(),
  startRecognition: vi.fn(),
  stopRecognition: vi.fn(),
  captureFrame: vi.fn(),
  compareFaceImages: vi.fn(),
  getFaceComparisonErrorMessage: vi.fn(),
}));

vi.mock("./services/faceComparison", () => ({ compareFaceImages, getFaceComparisonErrorMessage }));

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
      captureFrame: () => captureFrame(videoId),
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

  const view = render(
    <Provider store={store}>
      <App />
    </Provider>
  );

  await screen.findByRole("button", { name: "Stop Recognition 1" });
  await screen.findByRole("button", { name: "Stop Recognition 2" });

  return { user, store, ...view };
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

async function captureBoth(user) {
  await user.click(screen.getByRole("button", { name: "Stop Recognition 1" }));
  await user.click(screen.getByRole("button", { name: "Stop Recognition 2" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  startRecognition.mockReset().mockResolvedValue();
  stopRecognition.mockReset().mockReturnValue(null);
  captureFrame.mockReset().mockImplementation(() => document.createElement("canvas"));
  compareFaceImages.mockReset().mockResolvedValue({ distance: 0.4, threshold: 0.6, isMatch: true });
  getFaceComparisonErrorMessage.mockReset().mockReturnValue("Use a clear image containing exactly one face in each capture.");
  toastPromise.mockImplementation((promise) => promise);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  window.history.replaceState(null, "", window.location.pathname);
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

test("shows separate comparison pages through the sidebar", async () => {
  const { user } = await renderApp();

  expect(screen.getByRole("heading", { name: "Face Comparison" })).toBeInTheDocument();
  expect(screen.getByTestId("video1")).toBeInTheDocument();
  expect(screen.getByTestId("video2")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Voice Comparison" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Voice Comparison" }));
  await screen.findByRole("button", { name: "Record reference voice" });
  expect(screen.queryByTestId("video1")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Voice Comparison" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Record reference voice" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Record test voice" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Compare Voices" })).toBeDisabled();
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

test("sidebar links support navigation and Skip to content preserves the current page", async () => {
  const { user } = await renderApp();
  await user.click(screen.getByRole("button", { name: "Open menu" }));
  expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("link", { name: "Voice Translation" }));
  await screen.findByRole("heading", { name: "Voice Translation", level: 2 });
  expect(window.location.hash).toBe("#/voice-translation");
  await user.click(screen.getByRole("link", { name: "Skip to content" }));
  expect(window.location.hash).toBe("#/voice-translation");
  expect(screen.getByRole("main")).toHaveFocus();
  expect(screen.queryByTestId("video1")).not.toBeInTheDocument();
});

test("requires a stopped still image from both cameras before comparison", async () => {
  const { user } = await renderApp();

  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(toastError).toHaveBeenCalledWith(
    "Press Stop Recognition on each camera to capture a still image before comparing."
  );
  expect(compareFaceImages).not.toHaveBeenCalled();
});

test.each([
  { distance: 0.4, isMatch: true, expected: "Similar facial features" },
  { distance: 0.8, isMatch: false, expected: "Different facial features" },
])("compares captured pixels and displays $expected", async ({ distance, isMatch, expected }) => {
  const firstImage = document.createElement("canvas");
  const secondImage = document.createElement("canvas");
  captureFrame.mockImplementation((videoId) => videoId === "video1" ? firstImage : secondImage);
  compareFaceImages.mockResolvedValue({ distance, isMatch, threshold: 0.6 });
  const { user } = await renderApp();

  await captureBoth(user);
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(compareFaceImages).toHaveBeenCalledExactlyOnceWith(firstImage, secondImage);
  expect(captureFrame.mock.invocationCallOrder[0]).toBeLessThan(stopRecognition.mock.invocationCallOrder[0]);
  expect(screen.getByText(new RegExp(expected))).toHaveTextContent(`Feature distance: ${distance.toFixed(3)}; threshold: 0.600.`);
  expect(toastError).not.toHaveBeenCalled();
  // Console explanations must never include image or descriptor objects.
  const diagnosticCalls = [...console.log.mock.calls, ...console.warn.mock.calls];
  expect(diagnosticCalls.every((args) => args.every((value) => typeof value === "string"))).toBe(true);
});

test("explains a camera frame that is not ready and refuses comparison", async () => {
  captureFrame.mockReturnValue(null);
  const { user } = await renderApp();

  await captureBoth(user);
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(toastError).toHaveBeenCalledWith(
    "The camera frame is not ready. Start recognition and try capturing again."
  );
  expect(compareFaceImages).not.toHaveBeenCalled();
});

test("restarting a camera invalidates its previous stopped capture", async () => {
  const { user } = await renderApp();

  await captureBoth(user);
  await user.click(screen.getByRole("button", { name: "Start Recognition 1" }));
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(toastError).toHaveBeenCalledWith(
    "Press Stop Recognition on each camera to capture a still image before comparing."
  );
  expect(compareFaceImages).not.toHaveBeenCalled();
});

test("disables comparison while features are being computed and prevents duplicate calls", async () => {
  const comparison = deferred();
  compareFaceImages.mockReturnValue(comparison.promise);
  const { user } = await renderApp();
  await captureBoth(user);

  await user.click(screen.getByRole("button", { name: "Compare Faces" }));
  const pendingButton = screen.getByRole("button", { name: "Comparing facial features..." });
  expect(pendingButton).toBeDisabled();
  await user.click(pendingButton);
  expect(compareFaceImages).toHaveBeenCalledOnce();
  await act(async () => {
    comparison.resolve({ distance: 0.4, threshold: 0.6, isMatch: true });
  });
  expect(screen.getByRole("button", { name: "Compare Faces" })).toBeEnabled();
});

test("shows safe comparison errors and permits another attempt", async () => {
  compareFaceImages.mockRejectedValueOnce(new Error("private model diagnostic"));
  const { user } = await renderApp();
  await captureBoth(user);

  await user.click(screen.getByRole("button", { name: "Compare Faces" }));

  expect(getFaceComparisonErrorMessage).toHaveBeenCalledOnce();
  expect(toastError).toHaveBeenCalledWith("Use a clear image containing exactly one face in each capture.");
  expect(screen.queryByText(/private model diagnostic/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare Faces" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));
  expect(screen.getByText(/Similar facial features/)).toBeInTheDocument();
});

test.each(["resolve", "reject"])("ignores an obsolete comparison that %s after a camera restarts", async (completion) => {
  const comparison = deferred();
  compareFaceImages.mockReturnValue(comparison.promise);
  const { user } = await renderApp();
  await captureBoth(user);
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));
  await user.click(screen.getByRole("button", { name: "Start Recognition 1" }));
  // Even replacing the still while inference is pending must not restore the
  // result for the old pair of images.
  await user.click(screen.getByRole("button", { name: "Stop Recognition 1" }));

  await act(async () => {
    if (completion === "resolve") {
      comparison.resolve({ distance: 0.4, threshold: 0.6, isMatch: true });
    } else {
      comparison.reject(new Error("obsolete diagnostic"));
    }
  });
  expect(screen.queryByText(/Similar facial features/)).not.toBeInTheDocument();
  expect(toastError).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Compare Faces" })).toBeEnabled();
});

test("clears a displayed comparison when a camera restarts", async () => {
  const { user } = await renderApp();
  await captureBoth(user);
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));
  expect(screen.getByText(/Similar facial features/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Start Recognition 1" }));

  expect(screen.queryByText(/Similar facial features/)).not.toBeInTheDocument();
});

test.each(["resolve", "reject"])("ignores a pending comparison that %s after unmount", async (completion) => {
  const comparison = deferred();
  compareFaceImages.mockReturnValue(comparison.promise);
  const { user, unmount } = await renderApp();
  await captureBoth(user);
  await user.click(screen.getByRole("button", { name: "Compare Faces" }));
  unmount();

  await act(async () => {
    if (completion === "resolve") {
      comparison.resolve({ distance: 0.4, threshold: 0.6, isMatch: true });
    } else {
      comparison.reject(new Error("obsolete diagnostic"));
    }
  });

  expect(toastError).not.toHaveBeenCalled();
  expect(getFaceComparisonErrorMessage).not.toHaveBeenCalled();
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

test("offers an upload alternative when microphone recording is unsupported", async () => {
  const { user } = await renderApp();

  await user.click(screen.getByRole("link", { name: "Voice Comparison" }));
  await screen.findByRole("button", { name: "Record reference voice" });

  await user.click(screen.getByRole("button", { name: "Record reference voice" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Microphone recording is unavailable");
  expect(screen.getByLabelText("Upload reference voice")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Record reference voice" })).toBeEnabled();
});
