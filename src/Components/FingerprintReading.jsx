import { useEffect, useRef, useState } from "react";
import { checkDeviceAuthenticationSupport, getDeviceAuthenticationErrorMessage, registerDevice, verifyDevice } from "../services/deviceAuthentication.js";

const buttonClasses = "inline-flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400";
const secondaryClasses = "inline-flex items-center justify-center rounded-full border border-indigo-300 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-600 dark:text-indigo-200 dark:hover:bg-indigo-900/40";
const supportMessages = {
  checking: "Checking device authentication support...",
  available: "Your browser reports a device authenticator. Use the buttons below to open your device's sign-in prompt.",
  unavailable: "Set up Windows Hello, Touch ID, or your device's screen lock to use this page. A fingerprint reader is not required.",
  unsupported: "Device authentication is unavailable here. Open this app over HTTPS or localhost in a browser with WebAuthn support.",
  error: "Device support could not be checked. Retry after checking your device sign-in settings.",
};

export default function FingerprintReading() {
  const [support, setSupport] = useState("checking");
  const [registered, setRegistered] = useState(false);
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState("No device registered for this visit.");
  const [error, setError] = useState("");
  const registrationRef = useRef(null);
  const operationRef = useRef(null);
  const mountedRef = useRef(false);
  const supportVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const version = ++supportVersionRef.current;
    checkDeviceAuthenticationSupport().then((result) => {
      if (mountedRef.current && supportVersionRef.current === version) setSupport(result);
    });
    return () => {
      mountedRef.current = false;
      supportVersionRef.current += 1;
      operationRef.current?.abort();
      operationRef.current = null;
      registrationRef.current = null;
    };
  }, []);

  const retrySupport = async () => {
    if (support === "checking") return;
    const version = ++supportVersionRef.current;
    setSupport("checking");
    const result = await checkDeviceAuthenticationSupport();
    if (mountedRef.current && supportVersionRef.current === version) setSupport(result);
  };

  const run = async (action) => {
    if (operationRef.current) return;
    const controller = new AbortController();
    operationRef.current = controller;
    setPending(action);
    setError("");
    setStatus("Follow the sign-in prompt on your device.");
    try {
      const result = action === "register"
        ? await registerDevice({ signal: controller.signal })
        : await verifyDevice(registrationRef.current, { signal: controller.signal });
      if (!mountedRef.current || operationRef.current !== controller || controller.signal.aborted) return;
      registrationRef.current = result;
      setRegistered(true);
      setStatus(action === "register" ? "Device registered for this visit. You can now verify it." : "Device verified. Its signed response passed the local checks.");
    } catch (operationError) {
      if (!mountedRef.current || operationRef.current !== controller) return;
      setError(getDeviceAuthenticationErrorMessage(operationError));
      setStatus("Device authentication did not complete.");
    } finally {
      if (mountedRef.current && operationRef.current === controller) {
        operationRef.current = null;
        setPending("");
      }
    }
  };

  const cancel = () => {
    operationRef.current?.abort();
    operationRef.current = null;
    setPending("");
    setError("");
    setStatus("Device authentication cancelled.");
  };

  const clear = () => {
    registrationRef.current = null;
    setRegistered(false);
    setError("");
    setStatus("Local registration cleared. Device credentials can be managed in your operating system's sign-in settings.");
  };

  return (
    <section aria-labelledby="fingerprint-heading" className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800/60 sm:p-6">
      <h2 id="fingerprint-heading" className="text-xl font-semibold">Fingerprint &amp; device authentication</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">Use your device&apos;s fingerprint, face, or PIN through its secure sign-in prompt. Your device chooses the method. Websites cannot read raw fingerprints or require a fingerprint instead of another method.</p>
      <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
        <p role="status" className="text-sm text-slate-700 dark:text-slate-200">{supportMessages[support]}</p>
        {support !== "available" && support !== "checking" && <button type="button" className={`${secondaryClasses} mt-3`} onClick={retrySupport}>Check support again</button>}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className={buttonClasses} onClick={() => run("register")} disabled={support !== "available" || Boolean(pending) || registered}>{pending === "register" ? "Registering device..." : "Register device"}</button>
        <button type="button" className={buttonClasses} onClick={() => run("verify")} disabled={!registered || Boolean(pending)}>{pending === "verify" ? "Verifying device..." : "Verify device"}</button>
        <button type="button" className={secondaryClasses} onClick={clear} disabled={!registered || Boolean(pending)}>Clear registration</button>
        {pending && <button type="button" className={secondaryClasses} onClick={cancel}>Cancel device request</button>}
      </div>
      <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-300">{status}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <p className="mt-5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">This is a local device check, separate from the encrypted face vault. The app remembers only public registration information in memory for this page visit. Leaving the page or reloading clears it. Clearing here does not delete a credential from your device. Server account sign-in requires verification on a trusted server.</p>
    </section>
  );
}
