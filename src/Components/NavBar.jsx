import React, { useState, useMemo, useEffect } from "react";
import Icon from "../modules/icon";

const Navbar = ({ title, handleThemeChange, theme }) => {
  const [isOpen, setIsOpen] = useState(false);

  const navbarClasses = useMemo(() => {
    return theme === "light" ? "bg-gray-200 text-black" : "bg-gray-800 text-white";
  }, [theme]);

  const sidebarClasses = `transform top-0 left-0 w-64 ${navbarClasses} h-full fixed overflow-auto ease-in-out transition-all duration-300 z-30 ${
    isOpen ? "translate-x-0" : "-translate-x-full"
  }`;

  const iconColor = theme === "light" ? "black" : "white";

  useEffect(() => {
    console.log("Theme changed to:", theme);
  }, [theme]);

  return (
    <>
      <div className={`${navbarClasses}`}>
        {/* Top navigation bar */}
        <nav
          className={`${navbarClasses} p-4 flex justify-between items-center`}
        >
          <div className="text-lg font-bold">{title}</div>
          <button
            className={`md:hidden ${iconColor}`}
            onClick={() => setIsOpen(!isOpen)}
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
          <div className="hidden md:flex">
            <a href="#" className={`p-2 ${iconColor}`}>
              In progress
            </a>
            {theme !== "light" ? (
              <Icon
                icon="heroicons:sun"
                size="h-6 w-6"
                style={{ color: iconColor }}
                onClick={(event) => handleThemeChange(event)}
              />
            ) : (
              <Icon
                icon="heroicons:moon"
                size="h-6 w-6"
                style={{ color: iconColor }}
                onClick={(event) => handleThemeChange(event)}
              />
            )}
          </div>
        </nav>

        {/* Sidebar */}
        <div className={sidebarClasses}>
          <button
            className={`text-${iconColor} p-2`}
            onClick={() => setIsOpen(false)}
          >
            {/* Replace with icon */}
            x
          </button>
          <a href="#" className={`block p-2 ${iconColor}`}>
            Home
          </a>
          <a href="#" className={`block p-2 ${iconColor}`}>
            About
          </a>
          <a href="#" className={`block p-2 ${iconColor}`}>
            Services
          </a>
          <a href="#" className={`block p-2 ${iconColor}`}>
            Contact
          </a>
        </div>
      </div>
    </>
  );
};

export default Navbar;
