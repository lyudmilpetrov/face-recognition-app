import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";

export default function InstallApp() {
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const promptRef = useRef(null);
  const promptingRef = useRef(false);
  const installedRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const standalone = window.matchMedia?.("(display-mode: standalone)");
    const isStandalone = () => standalone?.matches || navigator.standalone === true;
    installedRef.current = isStandalone();

    const installed = () => {
      installedRef.current = true;
      promptRef.current = null;
      setAvailable(false);
      setPending(false);
    };
    const capturePrompt = (event) => {
      if (installedRef.current || isStandalone() || typeof event.prompt !== "function") return;
      event.preventDefault();
      promptRef.current = event;
      setAvailable(true);
    };
    const displayModeChanged = () => {
      if (isStandalone()) installed();
    };

    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", installed);
    standalone?.addEventListener?.("change", displayModeChanged);
    return () => {
      mountedRef.current = false;
      promptRef.current = null;
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", installed);
      standalone?.removeEventListener?.("change", displayModeChanged);
    };
  }, []);

  const install = async () => {
    const event = promptRef.current;
    if (!event || promptingRef.current || installedRef.current) return;
    // The browser permits each event's prompt to be used only once.
    promptRef.current = null;
    promptingRef.current = true;
    setPending(true);
    try {
      const result = await event.prompt();
      const choice = result?.outcome ? result : await event.userChoice;
      if (choice?.outcome === "accepted") {
        installedRef.current = true;
        promptRef.current = null;
      }
    } catch {
      if (mountedRef.current && !installedRef.current) {
        toast.error("Unable to open installation. Try again when your browser offers it.");
      }
    } finally {
      promptingRef.current = false;
      if (mountedRef.current) {
        setPending(false);
        setAvailable(!installedRef.current && Boolean(promptRef.current));
      }
    }
  };

  if (!available && !pending) return null;

  return (
    <button type="button" aria-label="Install app" title="Install app" aria-busy={pending} disabled={pending} onClick={install}
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg p-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-wait disabled:opacity-60 sm:px-3 dark:hover:bg-slate-800">
      <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
      </svg>
      <span className="hidden sm:inline">{pending ? "Installing…" : "Install app"}</span>
    </button>
  );
}
