import { createSlice } from '@reduxjs/toolkit';

const getInitialTheme = () => {
    if (typeof window === "undefined") {
        return "light";
    }
    const storedTheme = window.localStorage.getItem("theme");
    if (storedTheme === "light" || storedTheme === "dark") {
        return storedTheme;
    }
    const prefersDarkMode =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDarkMode ? "dark" : "light";
};

const initialState = {
    path: "",
    error: "",
    message: "",
    signalr: {},
    theme: getInitialTheme(),
    // need to capture the prefers-color-scheme media query in the store
    // so that it can be used in the theme provider
    prefersLightMode: typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches
        ? true
        : false,
    GlobalCallErrors: [],
    constants: {
        drawerWidth: 240,
    },
};

const mainSlice = createSlice({
    name: 'main',
    initialState,
    reducers: {
        set: (state, action) => {
            state[action.target] = action.payload;
        },
        setTheme: (state, action) => {
            state.theme = action.payload;
        },
        setPath: (state, action) => {
            state.path = action.payload;
        },
        setError: (state, action) => {
            state.error = action.payload;
        },
        setMessage: (state, action) => {
            state.message = action.payload;
        },
        setSignalr: (state, action) => {
            state.signalr = action.payload;
        },
        setPrefersLightMode: (state, action) => {
            state.prefersLightMode = action.payload;
        },      
        setGlobalCallErrors: (state, action) => {
            state.GlobalCallErrors = action.payload;
        },
    },
});

export const {
    set,
    setTheme,
    setPath,
    setError,
    setMessage,
    setSignalr,
    setPrefersLightMode,
    setGlobalCallErrors
} = mainSlice.actions;

export default mainSlice.reducer;
