import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import FaceLock, { IDLE_LOCK_MS } from "./FaceLock";

const mocks = vi.hoisted(() => ({
  extract: vi.fn(), start: vi.fn(), stop: vi.fn(), capture: vi.fn(),
  validate: vi.fn(), verify: vi.fn(), create: vi.fn(), open: vi.fn(), recover: vi.fn(), save: vi.fn(), read: vi.fn(), write: vi.fn(), remove: vi.fn(), normalize: vi.fn(),
}));
vi.mock("../services/faceComparison", () => ({ extractFaceDescriptor: mocks.extract, getFaceComparisonErrorMessage: () => "Show exactly one clear face and retry." }));
vi.mock("../services/faceVault", () => ({
  ENROLLMENT_SAMPLE_COUNT: 2, VERIFY_SAMPLE_COUNT: 2, MAX_NOTE_LENGTH: 10000,
  validateEnrollment: mocks.validate, verifyFaceSamples: mocks.verify, createVault: mocks.create,
  openVault: mocks.open, recoverVault: mocks.recover, saveVaultContent: mocks.save,
  readVaultRecord: mocks.read, writeVaultRecord: mocks.write, deleteVaultRecord: mocks.remove, validateVaultRecord: mocks.normalize,
  getVaultErrorMessage: () => "Unable to open or save the vault. Try again.",
}));
vi.mock("./FaceRecognitionBlaze", async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import("react");
  return { default: forwardRef(function Camera(_, ref) {
    useImperativeHandle(ref, () => ({ startFaceRecognition: mocks.start, stopFaceRecognition: mocks.stop, captureFrame: mocks.capture }));
    useEffect(() => () => mocks.stop(), []);
    return <div data-testid="vault-camera" />;
  }) };
});

const encrypted = { id: "ciphertext-only" };
const template = { descriptors: [[1]], modelVersion: "test" };
const key = {};
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { subtle: {} });
  vi.stubGlobal("indexedDB", {});
  mocks.read.mockReset().mockResolvedValue(encrypted);
  mocks.start.mockReset().mockResolvedValue();
  mocks.capture.mockImplementation(() => document.createElement("canvas"));
  mocks.extract.mockReset().mockResolvedValue(new Float32Array([1]));
  mocks.validate.mockReturnValue(template);
  mocks.verify.mockReturnValue({ isMatch: true, distance: 0.2, threshold: 0.6 });
  mocks.open.mockReset().mockImplementation(async () => ({ key, template, note: "My private information" }));
  mocks.recover.mockReset().mockImplementation(async () => ({ key, template: null, note: "Recovered information" }));
  mocks.create.mockReset().mockResolvedValue(encrypted);
  mocks.write.mockReset().mockResolvedValue();
  mocks.remove.mockReset().mockResolvedValue();
  mocks.save.mockReset().mockResolvedValue({ id: "updated-ciphertext" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function ready() {
  const user = userEvent.setup();
  const view = render(<FaceLock />);
  await screen.findByRole("heading", { name: "Open your vault" });
  return { user, ...view };
}
async function beginFaceCheck(user) {
  await user.type(screen.getByLabelText("Vault passphrase"), "correct passphrase");
  await user.click(screen.getByRole("button", { name: "Continue to face check" }));
  await screen.findByRole("button", { name: "Start camera" });
  await user.click(screen.getByRole("button", { name: "Start camera" }));
}
async function finishFaceCheck(user) {
  await user.click(screen.getByRole("button", { name: "Capture verification sample" }));
  await user.click(screen.getByRole("button", { name: "Capture verification sample" }));
  await screen.findByRole("heading", { name: "Your private note" });
}

test("only reveals the note after the passphrase and a complete face check, then fully locks", async () => {
  const { user } = await ready();
  expect(mocks.start).not.toHaveBeenCalled();
  await beginFaceCheck(user);
  expect(screen.queryByDisplayValue("My private information")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Capture verification sample" }));
  expect(screen.queryByRole("heading", { name: "Your private note" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Capture verification sample" }));
  expect(screen.getByLabelText("Note")).toHaveValue("My private information");
  await user.click(screen.getByRole("button", { name: "Lock now" }));
  expect(screen.queryByDisplayValue("My private information")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Vault passphrase")).toHaveValue("");
  expect(mocks.stop).toHaveBeenCalled();
});

test("a face mismatch keeps the note hidden and supports a clean retry", async () => {
  const { user } = await ready();
  await beginFaceCheck(user);
  mocks.verify.mockReturnValueOnce({ isMatch: false });
  for (let index = 0; index < 2; index += 1) await user.click(screen.getByRole("button", { name: "Capture verification sample" }));
  expect(screen.getByRole("alert")).toHaveTextContent("did not match");
  expect(screen.queryByDisplayValue("My private information")).not.toBeInTheDocument();
  await finishFaceCheck(user);
});

test("locking cancels a pending descriptor so a late result cannot reveal information", async () => {
  const pending = deferred();
  const { user } = await ready();
  await beginFaceCheck(user);
  await user.click(screen.getByRole("button", { name: "Capture verification sample" }));
  mocks.extract.mockReturnValueOnce(pending.promise);
  await user.click(screen.getByRole("button", { name: "Capture verification sample" }));
  await user.click(screen.getByRole("button", { name: "Lock now" }));
  await act(async () => pending.resolve(new Float32Array([1])));
  expect(screen.getByRole("heading", { name: "Open your vault" })).toBeInTheDocument();
  expect(screen.queryByDisplayValue("My private information")).not.toBeInTheDocument();
  expect(mocks.verify).not.toHaveBeenCalled();
});

test("leaving during passphrase derivation ignores completion and never starts a camera", async () => {
  const pending = deferred();
  mocks.open.mockReturnValueOnce(pending.promise);
  const { user, unmount } = await ready();
  await user.type(screen.getByLabelText("Vault passphrase"), "correct passphrase");
  await user.click(screen.getByRole("button", { name: "Continue to face check" }));
  unmount();
  await act(async () => pending.resolve({ key, template, note: "hidden" }));
  expect(mocks.start).not.toHaveBeenCalled();
});

test("passphrase recovery is explicit and requires re-enrollment before editing", async () => {
  const { user } = await ready();
  await user.type(screen.getByLabelText("Vault passphrase"), "correct passphrase");
  await user.click(screen.getByRole("checkbox", { name: /Use passphrase recovery/ }));
  await user.click(screen.getByRole("button", { name: "Recover with passphrase" }));
  expect(screen.getByLabelText("Note")).toHaveValue("Recovered information");
  expect(screen.getByLabelText("Note")).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "Save encrypted note" })).toBeDisabled();
  expect(mocks.start).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Re-enroll face" }));
  expect(screen.getByLabelText("Private note")).toHaveValue("Recovered information");
});

test("creation needs reference samples and fresh confirmation; persists only the encrypted record", async () => {
  mocks.read.mockResolvedValueOnce(null);
  const user = userEvent.setup();
  render(<FaceLock />);
  await screen.findByRole("heading", { name: "Enroll your face" });
  expect(screen.getByRole("button", { name: "Create encrypted vault" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Start camera" }));
  for (let index = 0; index < 2; index += 1) await user.click(screen.getByRole("button", { name: "Capture enrollment sample" }));
  expect(screen.getByRole("button", { name: "Create encrypted vault" })).toBeDisabled();
  for (let index = 0; index < 2; index += 1) await user.click(screen.getByRole("button", { name: "Capture verification sample" }));
  await user.type(screen.getByLabelText("Private note"), "First secret");
  await user.type(screen.getByLabelText("New passphrase"), "a strong passphrase");
  await user.type(screen.getByLabelText("Confirm passphrase"), "a strong passphrase");
  await user.click(screen.getByRole("button", { name: "Create encrypted vault" }));
  expect(mocks.create).toHaveBeenCalledWith("a strong passphrase", template, "First secret");
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith(encrypted);
  await screen.findByRole("heading", { name: "Open your vault" });
  expect(screen.queryByDisplayValue("First secret")).not.toBeInTheDocument();
});

test("failed encrypted writes keep unsaved edits available for a retry", async () => {
  const { user } = await ready();
  await beginFaceCheck(user);
  await finishFaceCheck(user);
  await user.type(screen.getByLabelText("Note"), " edited");
  mocks.write.mockRejectedValueOnce(new Error("private db internals"));
  await user.click(screen.getByRole("button", { name: "Save encrypted note" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to open or save");
  expect(screen.getByLabelText("Note")).toHaveValue("My private information edited");
  expect(screen.getByRole("button", { name: "Save encrypted note" })).toBeEnabled();
  expect(screen.queryByText("private db internals")).not.toBeInTheDocument();
});

test("hiding the page clears revealed note content", async () => {
  const { user } = await ready();
  await beginFaceCheck(user);
  await finishFaceCheck(user);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.queryByDisplayValue("My private information")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Open your vault" })).toBeInTheDocument();
});

test("five minutes of inactivity locks an open vault", async () => {
  const { user } = await ready();
  await beginFaceCheck(user);
  vi.useFakeTimers();
  // Moving into the unlocked stage installs its inactivity timer.
  fireEvent.click(screen.getByRole("button", { name: "Capture verification sample" }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Capture verification sample" }));
  await act(async () => {});
  expect(screen.getByLabelText("Note")).toHaveValue("My private information");
  act(() => vi.advanceTimersByTime(IDLE_LOCK_MS));
  expect(screen.queryByDisplayValue("My private information")).not.toBeInTheDocument();
});

test("blocked storage is a retryable error and cannot silently create a second vault", async () => {
  mocks.read.mockRejectedValueOnce(new Error("database denied"));
  render(<FaceLock />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Retry local storage" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Create encrypted vault" })).not.toBeInTheDocument();
});

test("restarting capture enrollment preserves the draft note", async () => {
  mocks.read.mockResolvedValueOnce(null);
  const user = userEvent.setup();
  render(<FaceLock />);
  await screen.findByRole("heading", { name: "Enroll your face" });
  await user.type(screen.getByLabelText("Private note"), "Keep this draft");
  await user.click(screen.getByRole("button", { name: "Restart enrollment" }));
  expect(screen.getByLabelText("Private note")).toHaveValue("Keep this draft");
  expect(screen.getByRole("button", { name: "Create encrypted vault" })).toBeDisabled();
});

test("deleting an unreadable vault requires acknowledgement and enables backup restoration", async () => {
  mocks.read.mockRejectedValueOnce(new Error("unsupported record"));
  const user = userEvent.setup();
  render(<FaceLock />);
  await screen.findByRole("button", { name: "Retry local storage" });
  await user.click(screen.getByText("Delete local vault and enrollment"));
  expect(screen.getByRole("button", { name: "Delete vault permanently" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /I understand that the local note/ }));
  await user.click(screen.getByRole("button", { name: "Delete vault permanently" }));
  expect(mocks.remove).toHaveBeenCalledOnce();
  await screen.findByLabelText("Restore a vault backup");
});

test("restoring a backup normalizes it before storing and never reveals its content", async () => {
  mocks.read.mockResolvedValueOnce(null);
  mocks.normalize.mockReturnValue(encrypted);
  render(<FaceLock />);
  const fileInput = await screen.findByLabelText("Restore a vault backup");
  const file = { size: 100, text: async () => JSON.stringify({ id: "untrusted-envelope" }) };
  fireEvent.change(fileInput, { target: { files: [file] } });
  await screen.findByRole("heading", { name: "Open your vault" });
  expect(mocks.normalize).toHaveBeenCalledWith({ id: "untrusted-envelope" });
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith(encrypted);
  expect(mocks.open).not.toHaveBeenCalled();
});
