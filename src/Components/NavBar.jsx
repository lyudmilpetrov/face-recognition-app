import React, { useState } from 'react';

const Navbar = ({title}) => {
    const [isOpen, setIsOpen] = useState(false);

    const sidebarClasses = `transform top-0 left-0 w-64 bg-gray-800 h-full fixed overflow-auto ease-in-out transition-all duration-300 z-30 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`;

    return (
        <div>
            {/* Top navigation bar */}
            <nav className="bg-gray-800 text-white p-4 flex justify-between items-center">
                <div className="text-lg font-bold">{title}</div>
                <button className="text-white md:hidden" onClick={() => setIsOpen(!isOpen)}>
                    <svg className="w-6 h-6" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                        <path d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                </button>
                <div className="hidden md:flex">
                    {/* <a href="#" className="text-white p-2">Home</a>
                    <a href="#" className="text-white p-2">About</a>
                    <a href="#" className="text-white p-2">Services</a>
                    <a href="#" className="text-white p-2">Contact</a> */}
                </div>
            </nav>
            
            {/* Sidebar */}
            <div className={sidebarClasses}>
                <button className="text-white p-2" onClick={() => setIsOpen(false)}>Close</button>
                <a href="#" className="block text-white p-2">Home</a>
                <a href="#" className="block text-white p-2">About</a>
                <a href="#" className="block text-white p-2">Services</a>
                <a href="#" className="block text-white p-2">Contact</a>
            </div>

            {/* Page content */}
            {/* <div className="p-4 md:pl-64">
                <h1 className="text-2xl font-bold">Welcome to MyApp</h1>
            </div> */}
        </div>
    );
};

export default Navbar;
