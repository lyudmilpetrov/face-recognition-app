import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/face-recognition-app/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: "build",
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.js"],
    clearMocks: true,
    restoreMocks: true,
  },
});
