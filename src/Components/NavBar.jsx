import React, { useState } from "react";
import Icon from "../modules/icon";

const Navbar = ({ title, handleThemeChange, theme }) => {
  const [isOpen, setIsOpen] = useState(false);

  const navbarClasses =
    "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100";

  const sidebarClasses = `transform top-0 left-0 w-64 ${navbarClasses} h-full fixed overflow-auto ease-in-out transition-all duration-300 z-30 ${
    isOpen ? "translate-x-0" : "-translate-x-full"
  }`;

  const iconClasses = "text-slate-900 dark:text-slate-100";

  return (
    <>
      <div className={`${navbarClasses}`}>
        {/* Top navigation bar */}
        <nav
          className={`${navbarClasses} px-4 py-3 flex justify-between items-center`}
        >
          <div className="text-base font-semibold sm:text-lg">{title}</div>
          <button
            className={`md:hidden ${iconClasses}`}
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle navigation menu"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
          <div className="hidden items-center gap-3 md:flex">
            <a
              href="#"
              className="rounded px-2 py-1 text-sm font-medium text-slate-600 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              In progress
            </a>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-2 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={handleThemeChange}
              aria-label="Toggle color theme"
            >
              {theme !== "light" ? (
                <Icon
                  icon="heroicons:sun"
                  size="h-6 w-6"
                  className={iconClasses}
                />
              ) : (
                <Icon
                  icon="heroicons:moon"
                  size="h-6 w-6"
                  className={iconClasses}
                />
              )}
            </button>
          </div>
        </nav>

        {/* Sidebar */}
        <div className={sidebarClasses}>
          <button
            className="p-2 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            onClick={() => setIsOpen(false)}
            aria-label="Close navigation menu"
          >
            {/* Replace with icon */}
            ✕
          </button>
          <a href="#" className="block p-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            Home
          </a>
          <a href="#" className="block p-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            About
          </a>
          <a href="#" className="block p-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            Services
          </a>
          <a href="#" className="block p-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            Contact
          </a>
          <button
            type="button"
            className="mt-4 flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={handleThemeChange}
          >
            {theme !== "light" ? (
              <>
                <Icon
                  icon="heroicons:sun"
                  size="h-5 w-5"
                  className={iconClasses}
                />
                Switch to light mode
              </>
            ) : (
              <>
                <Icon
                  icon="heroicons:moon"
                  size="h-5 w-5"
                  className={iconClasses}
                />
                Switch to dark mode
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
};

export default Navbar;
