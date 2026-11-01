import React, { useState } from "react";
import { DeviceCapabilities } from "./DeviceCapabilities";
import InstallApp from "./InstallApp.jsx";

const icons = {
  "face-comparison": "M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M9 9h.01M15 9h.01M8 14c2 3 6 3 8 0",
  "voice-comparison": "M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4",
  "voice-translation": "M4 5h12M10 3v2m4 0c-1 6-4 9-9 11m2-8c1 4 4 6 7 8m0 5 4-11 4 11m-6-4h4",
  "lock-unlock": "M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1m6 4v3",
  "fingerprint-reading": "M4 10a8 8 0 0 1 16 0m-13 2a5 5 0 0 1 10 0c0 4-1 7-3 9M10 12a2 2 0 0 1 4 0c0 4-1 6-3 8M4 14c0 3-1 4-1 4m4-3c0 3-1 5-2 6m15-7c0 2 0 4-1 6",
};

export default function Navbar({ pages, activePage, onNavigate, theme, handleThemeChange }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 lg:ml-64">
        <button type="button" aria-expanded={isOpen} aria-controls="tool-sidebar" onClick={() => setIsOpen((open) => !open)} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800 lg:hidden">{isOpen ? "Close menu" : "Open menu"}</button>
        <span className="hidden text-sm font-medium text-slate-600 dark:text-slate-300 sm:inline">Browser laboratory</span>
        <div className="ml-auto flex items-center gap-2">
          <InstallApp />
          <DeviceCapabilities />
          <button type="button" aria-label="Toggle color theme" onClick={handleThemeChange} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800">{theme === "light" ? "Dark mode" : "Light mode"}</button>
        </div>
      </header>
      <aside id="tool-sidebar" aria-label="Tools" className={`${isOpen ? "block" : "hidden"} border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:block lg:w-64 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-5`}>
        <div className="mb-7 hidden lg:block">
          <p className="text-lg font-semibold tracking-tight">Recognition Lab</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Face, voice & device tools</p>
        </div>
        <nav aria-label="Main navigation" className="flex flex-col gap-2">
          {pages.map((page) => (
            <a key={page.id} href={`#/${page.id}`} aria-current={activePage === page.id ? "page" : undefined} onClick={() => { setIsOpen(false); onNavigate?.(); }} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${activePage === page.id ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[page.id]} /></svg>
              {page.title}
            </a>
          ))}
        </nav>
        <p className="mt-8 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Camera and microphone tools run only on their respective pages. Face data stays in your browser.</p>
      </aside>
    </>
  );
}
