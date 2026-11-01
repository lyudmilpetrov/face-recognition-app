import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { DeviceCapabilities } from "./DeviceCapabilities";
import { collectDeviceCapabilities } from "../utils/deviceCapabilities.js";

vi.mock("../utils/deviceCapabilities.js", () => ({
  collectDeviceCapabilities: vi.fn(),
}));

function capabilities(overrides = {}) {
  return {
    cpuThreads: 12,
    memoryGb: 8,
    wasmSupported: true,
    wasmThreads: true,
    gpu: {
      status: "available",
      name: "Example GPU",
      isFallback: false,
      supportsFp16: true,
      maxBufferSize: 1024 ** 3,
      maxStorageBufferBindingSize: 128 * 1024 ** 2,
    },
    storage: { status: "available", usage: 1024 ** 3, remaining: 3 * 1024 ** 3 },
    authentication: {
      secureContext: true,
      webauthnSupported: true,
      platformAuthenticator: "available",
    },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function row(label) {
  return screen.getByText(label, { selector: "dt" }).parentElement;
}

beforeEach(() => {
  collectDeviceCapabilities.mockReset().mockResolvedValue(capabilities());
});

test("checks only when opened and announces loading before rendering browser capabilities", async () => {
  const pending = deferred();
  collectDeviceCapabilities.mockReturnValue(pending.promise);
  const user = userEvent.setup();
  render(<DeviceCapabilities />);

  const trigger = screen.getByRole("button", { name: "Device capabilities" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(collectDeviceCapabilities).not.toHaveBeenCalled();

  await user.click(trigger);
  const panel = screen.getByRole("region", { name: "Device capabilities" });
  expect(panel).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-controls", panel.id);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(/detecting|checking/i);

  await act(async () => pending.resolve(capabilities()));
  expect(screen.getByText("Example GPU")).toBeInTheDocument();
  expect(row("CPU threads")).toHaveTextContent("12");
  expect(row("Device memory (estimate)")).toHaveTextContent("8 GiB");
  expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("shows device sign-in availability without claiming a fingerprint reader was detected", async () => {
  const user = userEvent.setup();
  render(<DeviceCapabilities />);
  await user.click(screen.getByRole("button", { name: "Device capabilities" }));

  await screen.findByRole("heading", { name: "Fingerprint & device sign-in" });
  expect(row("WebAuthn")).toHaveTextContent(/supported|available/i);
  expect(row("Device authenticator")).toHaveTextContent(/available/i);
  expect(row("Fingerprint reader")).toHaveTextContent(/cannot|not exposed|not detectable|not reported|not confirmed/i);
  expect(row("Raw fingerprint access")).toHaveTextContent(/not|unavailable|cannot/i);
  expect(row("Device authenticator")).toHaveTextContent(/Windows Hello/i);
});

test("Escape and the close button dismiss the panel and restore trigger focus", async () => {
  const user = userEvent.setup();
  render(<DeviceCapabilities />);
  const trigger = screen.getByRole("button", { name: "Device capabilities" });

  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Device capabilities" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");

  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Close device capabilities" }));
  expect(screen.queryByRole("region", { name: "Device capabilities" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("closes on outside pointer and focus without moving focus back from another control", async () => {
  const user = userEvent.setup();
  render(<><DeviceCapabilities /><button type="button">Outside control</button></>);
  const trigger = screen.getByRole("button", { name: "Device capabilities" });
  const outside = screen.getByRole("button", { name: "Outside control" });

  await user.click(trigger);
  await user.click(outside);
  expect(screen.queryByRole("region", { name: "Device capabilities" })).not.toBeInTheDocument();
  expect(outside).toHaveFocus();

  await user.click(trigger);
  act(() => { outside.focus(); });
  expect(screen.queryByRole("region", { name: "Device capabilities" })).not.toBeInTheDocument();
  expect(outside).toHaveFocus();
});

test("Refresh reports updated capabilities and prevents concurrent refreshes", async () => {
  const pending = deferred();
  collectDeviceCapabilities.mockResolvedValueOnce(capabilities()).mockReturnValueOnce(pending.promise);
  const user = userEvent.setup();
  render(<DeviceCapabilities />);
  await user.click(screen.getByRole("button", { name: "Device capabilities" }));
  await screen.findByText("Example GPU");
  const refresh = screen.getByRole("button", { name: "Refresh" });
  await user.click(refresh);
  expect(refresh).toBeDisabled();
  expect(collectDeviceCapabilities).toHaveBeenCalledTimes(2);
  await user.click(refresh);
  expect(collectDeviceCapabilities).toHaveBeenCalledTimes(2);

  await act(async () => pending.resolve(capabilities({ cpuThreads: 16 })));
  expect(row("CPU threads")).toHaveTextContent("16");
  expect(refresh).toBeEnabled();
});

test("offers a safe retry when capability collection fails", async () => {
  collectDeviceCapabilities.mockRejectedValueOnce(new Error("Internal device details"));
  const user = userEvent.setup();
  render(<DeviceCapabilities />);
  await user.click(screen.getByRole("button", { name: "Device capabilities" }));
  await screen.findByText(/could not check|unable to check/i);
  expect(screen.queryByText(/Internal device details/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText("Example GPU")).toBeInTheDocument();
});

test("keeps unknown hardware distinct from unsupported browser APIs", async () => {
  collectDeviceCapabilities.mockResolvedValue(capabilities({
    cpuThreads: null,
    memoryGb: null,
    wasmSupported: false,
    wasmThreads: false,
    gpu: { status: "unsupported" },
    storage: { status: "unsupported" },
    authentication: {
      secureContext: true,
      webauthnSupported: false,
      platformAuthenticator: "unsupported",
    },
  }));
  const user = userEvent.setup();
  render(<DeviceCapabilities />);
  await user.click(screen.getByRole("button", { name: "Device capabilities" }));
  await screen.findByRole("heading", { name: "Fingerprint & device sign-in" });

  expect(row("CPU threads")).toHaveTextContent(/not reported/i);
  expect(row("Device memory (estimate)")).toHaveTextContent(/not reported/i);
  expect(row("WebGPU")).toHaveTextContent(/not supported/i);
  expect(row("WebAuthn")).toHaveTextContent(/not supported|unavailable/i);
  expect(row("Fingerprint reader")).toHaveTextContent(/cannot|not exposed|not detectable|not reported|not confirmed/i);
});

test("ignores a closed panel's pending result after reopening", async () => {
  const oldCheck = deferred();
  collectDeviceCapabilities.mockReturnValueOnce(oldCheck.promise).mockResolvedValueOnce(capabilities({ cpuThreads: 24 }));
  const user = userEvent.setup();
  render(<DeviceCapabilities />);
  const trigger = screen.getByRole("button", { name: "Device capabilities" });
  await user.click(trigger);
  fireEvent.keyDown(document, { key: "Escape" });
  await user.click(trigger);
  await screen.findByText("Example GPU");
  expect(row("CPU threads")).toHaveTextContent("24");

  await act(async () => oldCheck.resolve(capabilities({ cpuThreads: 2 })));
  const panel = screen.getByRole("region", { name: "Device capabilities" });
  expect(within(panel).getByText("24")).toBeInTheDocument();
});
