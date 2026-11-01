import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import FingerprintReading from "./FingerprintReading.jsx";
import { checkDeviceAuthenticationSupport, registerDevice, verifyDevice } from "../services/deviceAuthentication.js";

vi.mock("../services/deviceAuthentication.js", () => ({
  checkDeviceAuthenticationSupport: vi.fn(),
  registerDevice: vi.fn(),
  verifyDevice: vi.fn(),
  getDeviceAuthenticationErrorMessage: () => "Device authentication did not complete. Please retry.",
}));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  checkDeviceAuthenticationSupport.mockReset().mockResolvedValue("available");
  registerDevice.mockReset().mockResolvedValue({ credentialId: "public-registration" });
  verifyDevice.mockReset().mockResolvedValue({ credentialId: "public-registration", signCount: 1 });
});

test("registers and verifies only on explicit actions and clears local registration", async () => {
  const user = userEvent.setup();
  render(<FingerprintReading />);
  await screen.findByText(/your browser reports a device authenticator/i);
  expect(registerDevice).not.toHaveBeenCalled();
  expect(verifyDevice).not.toHaveBeenCalled();
  expect(screen.getByText(/websites cannot read raw fingerprints/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verify device" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Register device" }));
  expect(await screen.findByText(/device registered for this visit/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Verify device" }));
  expect(await screen.findByText(/signed response passed the local checks/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear registration" }));
  expect(screen.getByRole("button", { name: "Verify device" })).toBeDisabled();
});

test("shows unsupported state and allows checking again", async () => {
  checkDeviceAuthenticationSupport.mockResolvedValueOnce("unsupported");
  const user = userEvent.setup();
  render(<FingerprintReading />);
  await screen.findByText(/open this app over HTTPS/i);
  expect(screen.getByRole("button", { name: "Register device" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check support again" }));
  await screen.findByText(/your browser reports a device authenticator/i);
  expect(screen.getByRole("button", { name: "Register device" })).toBeEnabled();
});

test("cancels pending prompts, prevents duplicate requests, and ignores late results", async () => {
  const pending = deferred();
  registerDevice.mockReturnValue(pending.promise);
  const user = userEvent.setup();
  render(<FingerprintReading />);
  await screen.findByText(/your browser reports a device authenticator/i);
  fireEvent.click(screen.getByRole("button", { name: "Register device" }));
  expect(screen.getByRole("button", { name: "Registering device..." })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Registering device..." }));
  expect(registerDevice).toHaveBeenCalledTimes(1);
  const signal = registerDevice.mock.calls[0][0].signal;
  await user.click(screen.getByRole("button", { name: "Cancel device request" }));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ credentialId: "late-result" }));
  expect(screen.getByRole("button", { name: "Verify device" })).toBeDisabled();
  expect(screen.getByText("Device authentication cancelled.")).toBeInTheDocument();
});

test("aborts a pending verification when leaving the page", async () => {
  const pending = deferred();
  verifyDevice.mockReturnValue(pending.promise);
  const user = userEvent.setup();
  const { unmount } = render(<FingerprintReading />);
  await screen.findByText(/your browser reports a device authenticator/i);
  await user.click(screen.getByRole("button", { name: "Register device" }));
  await user.click(screen.getByRole("button", { name: "Verify device" }));
  const signal = verifyDevice.mock.calls[0][1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ credentialId: "late-result" }));
});

test("shows safe retryable errors", async () => {
  registerDevice.mockRejectedValueOnce(new Error("private platform details"));
  const user = userEvent.setup();
  render(<FingerprintReading />);
  await screen.findByText(/your browser reports a device authenticator/i);
  await user.click(screen.getByRole("button", { name: "Register device" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Please retry");
  expect(screen.queryByText(/private platform details/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Register device" })).toBeEnabled();
});
