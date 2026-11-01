import "./App.css";
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import { useDispatch, useSelector } from "react-redux";
import Navbar from "./Components/NavBar";
import { setTheme } from "./slice/main-slice";

const FaceComparison = lazy(() => import("./Components/FaceComparison"));
const VoiceComparison = lazy(() => import("./Components/VoiceComparison"));
const VoiceTranslation = lazy(() => import("./Components/VoiceTranslation"));
const FaceLock = lazy(() => import("./Components/FaceLock"));
const FingerprintReading = lazy(() => import("./Components/FingerprintReading"));

export const pages = [
  { id: "face-comparison", title: "Face Comparison", description: "Compare facial features from two camera captures." },
  { id: "voice-comparison", title: "Voice Comparison", description: "Compare reference and test recordings locally." },
  { id: "voice-translation", title: "Voice Translation", description: "Transcribe and translate with supported on-device browser tools." },
  { id: "lock-unlock", title: "Lock / Unlock", description: "Enroll your face and protect a private note in this browser." },
  { id: "fingerprint-reading", title: "Fingerprint Reading", description: "Try your device's built-in authentication." },
];

function currentPage() {
  return pages.find((page) => `#/${page.id}` === window.location.hash) || pages[0];
}

function App() {
  const dispatch = useDispatch();
  const { theme } = useSelector((state) => state.main);
  const [page, setPage] = useState(currentPage);
  const headingRef = useRef(null);

  useEffect(() => {
    const navigate = () => {
      setPage(currentPage());
      headingRef.current?.focus();
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem("theme", theme);
    } catch {
      // A blocked preference store must not prevent navigation or theme changes.
    }
  }, [theme]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <Toaster position="top-right" />
      <a href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }} className="sr-only rounded-md bg-white p-3 text-indigo-700 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50">Skip to content</a>
      <Navbar pages={pages} activePage={page.id} onNavigate={() => headingRef.current?.focus()} theme={theme} handleThemeChange={() => dispatch(setTheme(theme === "light" ? "dark" : "light"))} />
      <main id="main-content" tabIndex={-1} className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 focus:outline-none sm:px-6 lg:ml-64 lg:px-8">
        <header>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-none sm:text-3xl">{page.title}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{page.description}</p>
        </header>
        <Suspense key={page.id} fallback={<p role="status" className="p-6 text-slate-600 dark:text-slate-300">Loading page…</p>}>
          {page.id === "face-comparison" && <FaceComparison />}
          {page.id === "voice-comparison" && <VoiceComparison />}
          {page.id === "voice-translation" && <VoiceTranslation />}
          {page.id === "lock-unlock" && <FaceLock />}
          {page.id === "fingerprint-reading" && <FingerprintReading />}
        </Suspense>
      </main>
    </div>
  );
}

export default App;
