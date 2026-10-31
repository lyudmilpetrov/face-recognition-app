import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import mainReducer from "./slice/main-slice";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("react-hot-toast", () => ({
  Toaster: () => null,
  toast: { error: toastError },
}));

vi.mock("./modules/icon", () => ({ default: () => null }));

vi.mock("./Components/FaceRecognitionBlaze", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");

  const MockFaceRecognition = forwardRef(function MockFaceRecognition(
    { videoId },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      startFaceRecognition: async () => {},
      stopFaceRecognition: () => null,
    }));

    return <video data-testid={videoId} />;
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
