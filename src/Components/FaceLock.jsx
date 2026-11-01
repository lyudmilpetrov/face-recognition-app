import React, { useCallback, useEffect, useRef, useState } from "react";
import FaceRecognitionBlaze from "./FaceRecognitionBlaze";
import { extractFaceDescriptor, getFaceComparisonErrorMessage } from "../services/faceComparison";
import {
  ENROLLMENT_SAMPLE_COUNT, VERIFY_SAMPLE_COUNT, MAX_NOTE_LENGTH,
  validateEnrollment, verifyFaceSamples, createVault, openVault, recoverVault,
  saveVaultContent, readVaultRecord, writeVaultRecord, deleteVaultRecord, validateVaultRecord, getVaultErrorMessage,
} from "../services/faceVault";

const button = "rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400";
const secondary = "rounded-full border border-slate-300 px-4 py-2.5 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800";
const input = "mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-600 dark:bg-slate-900";
const panel = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800/50 sm:p-6";
export const IDLE_LOCK_MS = 5 * 60 * 1000;

export default function FaceLock() {
  const [stage, setStage] = useState("loading");
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [cameraState, setCameraState] = useState("off");
  const [faceCount, setFaceCount] = useState(null);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [verificationCount, setVerificationCount] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [note, setNote] = useState("");
  const [setupNote, setSetupNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const cameraRef = useRef(null);
  const recordRef = useRef(null);
  const sessionRef = useRef(null);
  const samplesRef = useRef([]);
  const checksRef = useRef([]);
  const enrollmentRef = useRef(null);
  const versionRef = useRef(0);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);
  const statusRef = useRef(null);
  const supported = Boolean(globalThis.crypto?.subtle && globalThis.indexedDB);

  const active = (version) => mountedRef.current && versionRef.current === version;

  const stopCamera = useCallback(() => {
    cameraRef.current?.stopFaceRecognition();
    setCameraState("off");
    setFaceCount(null);
  }, []);

  const lock = useCallback((message = "Vault locked. Your passphrase is required to open it again.") => {
    versionRef.current += 1;
    sessionRef.current = null;
    enrollmentRef.current = null;
    samplesRef.current = [];
    checksRef.current = [];
    stopCamera();
    setNote("");
    setSetupNote("");
    setPassphrase("");
    setConfirmation("");
    setEnrolledCount(0);
    setVerificationCount(0);
    setConfirmed(false);
    setCanSave(false);
    setDirty(false);
    setError("");
    setRecovery(false);
    setDeleteConfirmed(false);
    setStatus(message);
    setStage(recordRef.current ? "locked" : "setup");
    statusRef.current?.focus();
  }, [stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    readVaultRecord().then((saved) => {
      if (cancelled) return;
      recordRef.current = saved;
      setRecord(saved);
      setStage(saved ? "locked" : "setup");
    }).catch((failure) => {
      if (cancelled) return;
      setError(getVaultErrorMessage(failure));
      setStage("storage-error");
    });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      versionRef.current += 1;
      sessionRef.current = null;
      enrollmentRef.current = null;
      samplesRef.current = [];
      checksRef.current = [];
      // The camera component releases its own stream/model on unmount.
    };
  }, []);

  useEffect(() => {
    if (!["setup", "verifying", "unlocked"].includes(stage)) return;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => lock("Locked after five minutes without activity."), IDLE_LOCK_MS);
    };
    const hide = () => {
      if (document.visibilityState === "hidden") lock("Locked when the page was hidden.");
    };
    const leave = () => lock("Locked when the page was left.");
    reset();
    document.addEventListener("pointerdown", reset);
    document.addEventListener("keydown", reset);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", reset);
      document.removeEventListener("keydown", reset);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
  }, [stage, lock]);

  async function perform(work) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    setError("");
    const version = versionRef.current;
    try {
      await work(version);
    } catch (failure) {
      if (active(version)) setError(getVaultErrorMessage(failure));
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  const startCamera = () => perform(async (version) => {
    setCameraState("starting");
    try {
      await cameraRef.current.startFaceRecognition();
      if (active(version)) {
        setCameraState("on");
        setStatus("Camera ready. Keep one face visible and capture distinct samples.");
      }
    } catch {
      if (active(version)) {
        stopCamera();
        setError("Unable to start the camera. Allow camera permission and try again.");
      }
    }
  });

  const captureSample = () => perform(async (version) => {
    const image = cameraRef.current?.captureFrame();
    if (!image) {
      setError("Wait for a playable camera frame, then capture again.");
      return;
    }
    let descriptor;
    try {
      descriptor = await extractFaceDescriptor(image);
    } catch (failure) {
      if (active(version)) setError(getFaceComparisonErrorMessage(failure));
      return;
    } finally {
      image.width = 0;
      image.height = 0;
    }
    if (!active(version)) return;
    if (stage === "setup" && !enrollmentRef.current) {
      const next = [...samplesRef.current, descriptor];
      if (next.length === ENROLLMENT_SAMPLE_COUNT) {
        try {
          enrollmentRef.current = validateEnrollment(next);
        } catch (failure) {
          samplesRef.current = [];
          setEnrolledCount(0);
          throw failure;
        }
        setStatus("Reference samples ready. Capture three fresh samples to confirm enrollment.");
      } else {
        setStatus("Sample captured. Slightly change your pose before the next capture.");
      }
      samplesRef.current = next;
      setEnrolledCount(next.length);
      return;
    }
    checksRef.current = [...checksRef.current, descriptor];
    setVerificationCount(checksRef.current.length);
    if (checksRef.current.length < VERIFY_SAMPLE_COUNT) {
      setStatus("Capture another fresh sample with a small change in pose.");
      return;
    }
    const template = stage === "setup" ? enrollmentRef.current : sessionRef.current?.template;
    const checks = checksRef.current;
    checksRef.current = [];
    const result = verifyFaceSamples(template, checks);
    if (!result.isMatch) {
      setVerificationCount(0);
      setError("The fresh samples did not match the enrolled face. Try again or cancel and use passphrase recovery.");
      return;
    }
    stopCamera();
    if (stage === "setup") {
      setConfirmed(true);
      setStatus("Enrollment confirmed. Set your passphrase and create the encrypted vault.");
    } else {
      setNote(sessionRef.current.note);
      sessionRef.current.note = "";
      setCanSave(true);
      setStage("unlocked");
      setStatus("Face check passed. Your note is unlocked.");
    }
  });

  const create = (event) => {
    event.preventDefault();
    if (!confirmed || !enrollmentRef.current) return;
    if (passphrase !== confirmation) {
      setError("The passphrases do not match.");
      return;
    }
    const secret = passphrase;
    const content = setupNote;
    const template = enrollmentRef.current;
    setPassphrase("");
    setConfirmation("");
    perform(async (version) => {
      const saved = await createVault(secret, template, content);
      if (!active(version)) return;
      await writeVaultRecord(saved);
      // An explicitly requested encrypted write may finish after Lock was used.
      // Update only ciphertext here; never restore a cancelled plaintext session.
      if (mountedRef.current) {
        recordRef.current = saved;
        setRecord(saved);
        lock("Enrollment and encrypted note saved. Unlock with your passphrase and face.");
      }
    });
  };

  const unlock = (event) => {
    event.preventDefault();
    const secret = passphrase;
    setPassphrase("");
    perform(async (version) => {
      const opened = await (recovery ? recoverVault(record, secret) : openVault(record, secret));
      if (!active(version)) return;
      sessionRef.current = opened;
      if (recovery) {
        setNote(opened.note);
        opened.note = "";
        setCanSave(false);
        setStage("unlocked");
        setStatus("Recovered with your passphrase. Re-enroll your face to save changes.");
      } else {
        checksRef.current = [];
        setVerificationCount(0);
        setStage("verifying");
        setStatus("Passphrase accepted. Start the camera and capture three samples to verify your face.");
      }
    });
  };

  const save = () => perform(async (version) => {
    const session = sessionRef.current;
    if (!session || !canSave) return;
    const saved = await saveVaultContent(record, session.key, session.template, note);
    if (!active(version)) return;
    await writeVaultRecord(saved);
    if (mountedRef.current) {
      recordRef.current = saved;
      setRecord(saved);
    }
    if (active(version)) {
      setDirty(false);
      setStatus("Encrypted note saved in this browser.");
    }
  });

  const reenroll = () => {
    const currentNote = note;
    lock("");
    setSetupNote(currentNote);
    setStage("setup");
    setStatus("Re-enroll your face and choose a passphrase. The existing vault is kept until the replacement is saved.");
  };

  const restartEnrollment = () => {
    versionRef.current += 1;
    enrollmentRef.current = null;
    samplesRef.current = [];
    checksRef.current = [];
    setEnrolledCount(0);
    setVerificationCount(0);
    setConfirmed(false);
    stopCamera();
    setError("");
    setStatus("Face samples cleared. Your draft note and passphrase fields are kept.");
  };

  const remove = () => {
    if (!deleteConfirmed) return;
    perform(async () => {
      await deleteVaultRecord();
      if (mountedRef.current) {
        recordRef.current = null;
        setRecord(null);
        lock("Local vault and face enrollment deleted. You can enroll again or restore an encrypted backup.");
      }
    });
  };

  const backup = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "recognition-lab-encrypted-vault.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Encrypted backup downloaded. Keep its passphrase separately; unsaved edits are not included.");
  };

  const restore = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || recordRef.current) return;
    perform(async (version) => {
      if (file.size > 250000) {
        setError("Choose an encrypted vault backup smaller than 250 KB.");
        return;
      }
      let restored;
      try {
        restored = validateVaultRecord(JSON.parse(await file.text()));
      } catch {
        if (active(version)) setError("This file is not a supported encrypted vault backup.");
        return;
      }
      if (!active(version)) return;
      await writeVaultRecord(restored);
      if (mountedRef.current) {
        recordRef.current = restored;
        setRecord(restored);
        lock("Backup restored. Enter its passphrase to open it.");
      }
    });
  };

  const captureLabel = stage === "setup" && !enrollmentRef.current ? "Capture enrollment sample" : "Capture verification sample";
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm leading-relaxed text-indigo-950 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
        Your passphrase encrypts your note and face template locally. The face check is experimental and has no liveness detection. Photos or videos may fool it. Keep your passphrase and an encrypted backup; clearing browser storage removes the vault.
      </div>
      <p ref={statusRef} tabIndex={-1} role="status" className="text-sm text-slate-600 focus:outline-none dark:text-slate-300">{busy ? "Working locally… " : ""}{status || (stage === "loading" ? "Checking local vault storage…" : record ? "Your vault is locked." : "No face enrolled yet. Start by enrolling below.")}</p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">{error}</p>}
      {!supported && <p className={panel}>This feature needs Web Crypto, IndexedDB, and HTTPS or localhost. Open it in a supported browser with site storage enabled.</p>}
      {stage === "storage-error" && <button type="button" className={secondary} onClick={() => window.location.reload()}>Retry local storage</button>}
      {supported && stage === "setup" && <>
        <section className={panel} aria-labelledby="enroll-title">
          <h2 id="enroll-title" className="text-lg font-semibold">{record ? "Replace face enrollment" : "Enroll your face"}</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Capture {ENROLLMENT_SAMPLE_COUNT} distinct samples of the same face, then {VERIFY_SAMPLE_COUNT} fresh confirmation samples. Use steady lighting and small pose changes. Captures are not saved as photographs.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span>Reference samples: {enrolledCount} / {ENROLLMENT_SAMPLE_COUNT}</span>
            <span>Confirmation: {verificationCount} / {VERIFY_SAMPLE_COUNT}</span>
            <button type="button" className={secondary} disabled={busy} onClick={restartEnrollment}>Restart enrollment</button>
          </div>
        </section>
      </>}
      {supported && stage === "locked" && <form className={panel} onSubmit={unlock}>
        <h2 className="text-lg font-semibold">Open your vault</h2>
        <label className="mt-4 block max-w-xl text-sm font-medium">Vault passphrase<input className={input} type="password" autoComplete="current-password" maxLength={1024} required value={passphrase} onChange={(event) => setPassphrase(event.target.value)} disabled={busy} /></label>
        <label className="my-4 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-indigo-600" checked={recovery} onChange={(event) => setRecovery(event.target.checked)} disabled={busy} />Use passphrase recovery to open without a face check. Re-enrollment is required before saving.</label>
        <button type="submit" className={button} disabled={busy}>{recovery ? "Recover with passphrase" : "Continue to face check"}</button>
      </form>}
      {supported && (stage === "verifying" || (stage === "setup" && !confirmed)) && <section className={panel} aria-label="Face capture">
        <div className="relative mx-auto aspect-video max-w-xl overflow-hidden rounded-xl bg-slate-950">
          <FaceRecognitionBlaze ref={cameraRef} videoId="vault-camera" canvasId="vault-canvas" frameColor="aqua" onFacesDetected={(faces) => setFaceCount(faces.length)} onRecognitionError={() => { versionRef.current += 1; stopCamera(); setError("Face detection stopped. Start the camera to retry."); }} />
          {cameraState === "off" && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">Camera is off</p>}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {cameraState === "off" ? <button type="button" className={secondary} disabled={busy} onClick={startCamera}>Start camera</button> : <button type="button" className={secondary} disabled={cameraState === "starting"} onClick={stopCamera}>Stop camera</button>}
          <button type="button" className={button} disabled={busy || cameraState !== "on"} onClick={captureSample}>{captureLabel}</button>
        </div>
        <p className="mt-3 text-center text-sm text-slate-600 dark:text-slate-300">{faceCount === null ? "Start the camera when ready." : faceCount === 1 ? "One face detected." : faceCount === 0 ? "No face detected." : "Keep only one face in view."}{stage === "verifying" && ` Verification: ${verificationCount} / ${VERIFY_SAMPLE_COUNT}.`}</p>
      </section>}
      {supported && stage === "setup" && (
        <form onSubmit={create} className={panel}>
          <h2 className="text-lg font-semibold">Protect your note</h2>
          <label className="mt-4 block text-sm font-medium">Private note<textarea className={input} rows={5} maxLength={MAX_NOTE_LENGTH} value={setupNote} onChange={(event) => setSetupNote(event.target.value)} disabled={busy} /></label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">New passphrase<input className={input} type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={passphrase} onChange={(event) => setPassphrase(event.target.value)} disabled={busy} /></label>
            <label className="block text-sm font-medium">Confirm passphrase<input className={input} type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>
          </div>
          <p className="my-4 text-sm text-slate-600 dark:text-slate-300">Use at least 12 characters. Your face cannot recover a forgotten passphrase. The note is saved only when you create the vault.</p>
          <button className={button} type="submit" disabled={busy || !confirmed}>Create encrypted vault</button>
        </form>
      )}
      {stage === "verifying" && <button type="button" className={secondary} onClick={() => lock("Verification cancelled. The vault is locked.")}>Cancel verification</button>}
      {stage === "unlocked" && <section className={panel} aria-labelledby="private-note-title">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="private-note-title" className="text-lg font-semibold">Your private note</h2><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">Unlocked</span></div>
        <label className="mt-4 block text-sm font-medium">Note<textarea className={input} rows={8} maxLength={MAX_NOTE_LENGTH} value={note} readOnly={!canSave} disabled={busy} onChange={(event) => { setNote(event.target.value); setDirty(true); }} /></label>
        <div className="mt-4 flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || !canSave || !dirty} onClick={save}>Save encrypted note</button><button type="button" className={secondary} disabled={busy} onClick={reenroll}>Re-enroll face</button></div>
        {dirty && <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">You have unsaved changes. Locking or leaving this page discards them.</p>}
      </section>}
      {record && <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} onClick={() => lock()}>Lock now</button>
        <button type="button" className={secondary} disabled={busy} onClick={backup}>Download encrypted backup</button>
        <p className="text-xs text-slate-500 dark:text-slate-400">Locks on page changes, when hidden, and after 5 minutes of inactivity.</p>
      </div>}
      {supported && (record || stage === "storage-error") && <details className={panel}>
        <summary className="cursor-pointer text-sm font-medium">Delete local vault and enrollment</summary>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">This permanently removes this browser's stored vault, including its encrypted note and face template. Download a backup first if you need to restore it. A damaged vault can also be cleared here before restoring a backup.</p>
        <label className="my-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} disabled={busy} className="mt-1 accent-red-600" />I understand that the local note and face enrollment will be permanently deleted.</label>
        <button type="button" className={secondary} disabled={busy || !deleteConfirmed} onClick={remove}>Delete vault permanently</button>
      </details>}
      {supported && !record && stage === "setup" && <section className={panel}><h2 className="text-lg font-semibold">Have an encrypted backup?</h2><label className="mt-3 block text-sm">Restore a vault backup<input className="mt-2 block max-w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-indigo-700 dark:file:bg-indigo-500/15 dark:file:text-indigo-200" type="file" accept="application/json,.json" onChange={restore} disabled={busy} /></label><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Restore is available only before a local vault exists.</p></section>}
    </div>
  );
}
