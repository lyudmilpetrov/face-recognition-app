import { useEffect, useId, useRef, useState } from "react";
import { collectDeviceCapabilities } from "../utils/deviceCapabilities.js";

const actionClasses = "inline-flex items-center justify-center rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800";

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "Not reported";
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}

function CapabilityRow({ label, value, note }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-2 sm:gap-x-4">
      <dt className="font-medium text-slate-600 dark:text-slate-300">{label}</dt>
      <dd className="min-w-0 wrap-break-word sm:text-right">{value}</dd>
      {note ? <dd className="text-xs leading-relaxed text-slate-500 sm:col-span-2 dark:text-slate-400">{note}</dd> : null}
    </div>
  );
}

function AuthenticationDetails({ authentication }) {
  const { secureContext, webauthnSupported, platformAuthenticator } = authentication;
  const status = {
    available: "Available for device sign-in",
    unavailable: "Not available in this browser/session",
    unsupported: "Capability check not supported",
    insecure: "Requires HTTPS or localhost",
    error: "Check failed or timed out — try Refresh",
  }[platformAuthenticator];

  return (
    <section aria-label="Fingerprint & device sign-in" className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 className="font-semibold">Fingerprint &amp; device sign-in</h3>
      <dl className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
        <CapabilityRow label="WebAuthn" value={!secureContext ? "Requires HTTPS or localhost" : webauthnSupported ? "Supported" : "Not supported in this browser"} />
        <CapabilityRow label="Device authenticator" value={status}
          note="Checks built-in device verification, such as Windows Hello. It does not identify the verification method." />
        <CapabilityRow label="Fingerprint reader" value="Cannot be detected by this browser check"
          note="An available authenticator may use a fingerprint, face, or PIN. This result cannot confirm a fingerprint sensor or enrolled fingerprints." />
        <CapabilityRow label="Raw fingerprint access" value="Not exposed to websites"
          note="WebAuthn lets the system verify you without sharing fingerprint images or templates with this app." />
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {platformAuthenticator === "available"
          ? "Your configured fingerprint reader may be used through Windows Hello in a WebAuthn sign-in flow. The system chooses the available method and may offer face or PIN instead."
          : platformAuthenticator === "insecure"
            ? "Open this app over HTTPS or localhost, then use Refresh to check device sign-in."
            : platformAuthenticator === "error"
              ? "Could not check device sign-in. Use Refresh to try again."
              : "A missing capability result does not prove a fingerprint reader is absent. Check your system's sign-in settings and try a browser with WebAuthn support."}
        {" "}On Windows, check Settings → Accounts → Sign-in options → Fingerprint recognition (Windows Hello).
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        This panel checks availability only. Fingerprint sign-in is not implemented in this demo; it would need WebAuthn registration and server-verified authentication.
      </p>
    </section>
  );
}

function CapabilityDetails({ data }) {
  const { gpu, storage } = data;
  const gpuAvailable = gpu.status === "available";
  const gpuStatus = {
    available: gpu.isFallback ? "Software adapter" : "Adapter available",
    unsupported: "Not supported in this browser/session",
    unavailable: "No adapter available",
    error: "Check failed or timed out — try Refresh",
  }[gpu.status];
  const summary = gpuAvailable
    ? gpu.isFallback
      ? "WebGPU is using a software adapter. Model performance may be limited."
      : "WebGPU is available. Model size and memory needs still determine what can run."
    : data.wasmSupported
      ? "WebAssembly is available for CPU models. GPU model support could not be confirmed."
      : "Local model support could not be confirmed in this session.";

  return (
    <>
      <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">{summary}</p>
      <dl className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        <CapabilityRow label="CPU threads" value={data.cpuThreads ?? "Not reported"}
          note="Logical processors reported to this browser; runtime thread counts may differ." />
        <CapabilityRow label="Device memory (estimate)" value={data.memoryGb ? `≈ ${data.memoryGb} GiB` : "Not reported"}
          note="Rounded and capped by the browser; this is not free RAM." />
        <CapabilityRow label="WebGPU" value={gpuStatus} />
        {gpuAvailable ? (
          <>
            <CapabilityRow label="GPU (browser default)" value={gpu.name} />
            <CapabilityRow label="FP16 shaders" value={gpu.supportsFp16 ? "Supported" : "Not supported"} />
            <CapabilityRow label="Maximum GPU buffer" value={formatBytes(gpu.maxBufferSize)} />
            <CapabilityRow label="GPU storage binding limit" value={formatBytes(gpu.maxStorageBufferBindingSize)}
              note="Per-buffer limits, not total or available GPU memory (VRAM)." />
          </>
        ) : null}
        <CapabilityRow label="WebAssembly (CPU runtime)" value={data.wasmSupported ? "Supported" : "Not supported"} />
        <CapabilityRow label="WASM multithreading" value={data.wasmThreads ? "Available to compatible runtimes" : "Unavailable in this session"}
          note={data.wasmThreads ? undefined : "Requires shared memory, workers, and an isolated page."} />
        <CapabilityRow label="Model-cache space (estimate)"
          value={storage.status === "available" ? `${formatBytes(storage.remaining)} remaining` : storage.status === "error" ? "Check failed or timed out — try Refresh" : "Not reported"}
          note={storage.status === "available" ? `${formatBytes(storage.usage)} used by this site. Browser quota, not free disk space; storage is not guaranteed.` : "The browser did not provide a storage estimate."} />
      </dl>
      <AuthenticationDetails authentication={data.authentication} />
      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Browser-reported capabilities, not live utilization. CPU model, free RAM, and VRAM are not exposed. Checks stay on this device and do not prompt for biometrics.</p>
    </>
  );
}

function CapabilityPanel({ id, onClose }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ status: "loading", data: null });
  const panelRef = useRef(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    collectDeviceCapabilities().then(
      (data) => {
        if (!cancelled) setResult({ status: "ready", data });
      },
      () => {
        if (!cancelled) setResult({ status: "error", data: null });
      },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  const isLoading = result.status === "loading";
  return (
    <section id={id} aria-labelledby={`${id}-title`} tabIndex={-1} ref={panelRef} aria-busy={isLoading}
      className="absolute inset-x-4 top-full z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-900 shadow-xl focus-visible:outline-2 focus-visible:outline-indigo-500 sm:inset-x-auto sm:right-0 sm:mt-2 sm:w-lg sm:p-5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-base font-semibold">Device capabilities</h2>
        <div className="flex items-center gap-1">
          <button type="button" className={actionClasses} disabled={isLoading} onClick={() => {
            panelRef.current?.focus();
            setResult({ status: "loading", data: null });
            setAttempt((current) => current + 1);
          }}>Refresh</button>
          <button type="button" className={actionClasses} aria-label="Close device capabilities" onClick={onClose}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </div>
      <p className="sr-only" role="status">
        {isLoading ? "Detecting device capabilities…" : result.status === "error" ? "Device check failed." : "Device capabilities updated."}
      </p>
      {isLoading ? <p className="mt-3 text-slate-600 dark:text-slate-300">Detecting CPU, GPU, memory, storage, and device sign-in…</p>
        : result.status === "error" ? <p className="mt-3 text-slate-600 dark:text-slate-300">Could not check this device. Use Refresh to try again.</p>
          : <CapabilityDetails data={result.data} />}
    </section>
  );
}

export function DeviceCapabilities() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!isOpen) return;
    const dismissOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    const dismissOnEscape = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="sm:relative" ref={containerRef}>
      <button type="button" className="inline-flex items-center justify-center rounded-md p-2 text-slate-900 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-slate-100 dark:hover:bg-slate-800"
        ref={triggerRef} title="Device capabilities" aria-label="Device capabilities" aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined} onClick={() => setIsOpen((current) => !current)}>
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
      </button>
      {isOpen ? <CapabilityPanel id={id} onClose={() => {
        setIsOpen(false);
        triggerRef.current?.focus();
      }} /> : null}
    </div>
  );
}
