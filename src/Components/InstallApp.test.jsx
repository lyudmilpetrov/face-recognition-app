import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import InstallApp from "./InstallApp.jsx";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("react-hot-toast", () => ({ toast: { error: toastError } }));

let displayMode;

beforeEach(() => {
  displayMode = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => displayMode));
});

afterEach(() => vi.unstubAllGlobals());

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function offerInstall(prompt = vi.fn().mockResolvedValue({ outcome: "dismissed" })) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  event.prompt = prompt;
  act(() => window.dispatchEvent(event));
  return event;
}

test("has no install promotion until the browser provides a usable install event", () => {
  render(<InstallApp />);
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
  const event = new Event("beforeinstallprompt", { cancelable: true });
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
});

test("captures the browser event and prompts only after an explicit install click", async () => {
  render(<InstallApp />);
  const event = offerInstall();
  expect(event.defaultPrevented).toBe(true);
  expect(event.prompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Install app" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument());
  expect(event.prompt).toHaveBeenCalledOnce();
});

test("disables a pending prompt, consumes it once, and can retry with a later browser event", async () => {
  const choice = deferred();
  render(<InstallApp />);
  const first = offerInstall(vi.fn().mockReturnValue(choice.promise));
  const button = screen.getByRole("button", { name: "Install app" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(first.prompt).toHaveBeenCalledOnce();
  await act(async () => choice.resolve({ outcome: "dismissed" }));
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();

  const second = offerInstall(vi.fn().mockResolvedValue({ outcome: "accepted" }));
  fireEvent.click(screen.getByRole("button", { name: "Install app" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument());
  expect(second.prompt).toHaveBeenCalledOnce();
  expect(first.prompt).toHaveBeenCalledOnce();
});

test("uses userChoice in browsers whose prompt method does not return the outcome", async () => {
  const choice = deferred();
  render(<InstallApp />);
  const event = offerInstall(vi.fn().mockResolvedValue(undefined));
  event.userChoice = choice.promise;
  fireEvent.click(screen.getByRole("button", { name: "Install app" }));
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Install app" })).toBeDisabled();
  await act(async () => choice.resolve({ outcome: "dismissed" }));
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
});

test("retains a new install offer received while the previous prompt is pending", async () => {
  const choice = deferred();
  render(<InstallApp />);
  offerInstall(vi.fn().mockReturnValue(choice.promise));
  fireEvent.click(screen.getByRole("button", { name: "Install app" }));
  const next = offerInstall();
  await act(async () => choice.resolve({ outcome: "dismissed" }));
  expect(screen.getByRole("button", { name: "Install app" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Install app" }));
  await waitFor(() => expect(next.prompt).toHaveBeenCalledOnce());
});

test("hides after an external installation and ignores future offers", () => {
  render(<InstallApp />);
  offerInstall();
  act(() => window.dispatchEvent(new Event("appinstalled")));
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
  const later = offerInstall();
  expect(later.defaultPrevented).toBe(false);
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
});

test("stays hidden when already running standalone or as an iOS home-screen app", () => {
  displayMode.matches = true;
  const { unmount } = render(<InstallApp />);
  offerInstall();
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
  unmount();
  displayMode.matches = false;
  vi.stubGlobal("navigator", { standalone: true });
  render(<InstallApp />);
  offerInstall();
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
});

test("hides an available offer when the window switches to standalone mode", () => {
  render(<InstallApp />);
  offerInstall();
  displayMode.matches = true;
  const onChange = displayMode.addEventListener.mock.calls[0][1];
  act(() => onChange());
  expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
});

test("consumes a failed prompt safely and permits a fresh browser offer", async () => {
  render(<InstallApp />);
  offerInstall(vi.fn().mockRejectedValue(new Error("private browser details")));
  fireEvent.click(screen.getByRole("button", { name: "Install app" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument());
  expect(toastError).toHaveBeenCalledWith("Unable to open installation. Try again when your browser offers it.");
  offerInstall();
  expect(screen.getByRole("button", { name: "Install app" })).toBeEnabled();
});

test("removes install/display listeners on unmount and ignores a late prompt result", async () => {
  const remove = vi.spyOn(window, "removeEventListener");
  const choice = deferred();
  const { unmount } = render(<InstallApp />);
  offerInstall(vi.fn().mockReturnValue(choice.promise));
  fireEvent.click(screen.getByRole("button", { name: "Install app" }));
  const onChange = displayMode.addEventListener.mock.calls[0][1];
  unmount();
  expect(remove).toHaveBeenCalledWith("beforeinstallprompt", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("appinstalled", expect.any(Function));
  expect(displayMode.removeEventListener).toHaveBeenCalledWith("change", onChange);
  const later = offerInstall();
  expect(later.defaultPrevented).toBe(false);
  await act(async () => choice.reject(new Error("private browser details")));
  expect(toastError).not.toHaveBeenCalled();
});
