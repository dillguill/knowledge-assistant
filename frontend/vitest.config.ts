import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    // Vite loads `.env.local` here too, so a developer who points the dev
    // server at a local backend (`VITE_API_URL=http://127.0.0.1:8000`) makes
    // the whole suite attempt live network calls — tests fail with
    // ECONNREFUSED unless that backend happens to be running. Pinning it
    // empty keeps runs hermetic and identical to CI, which has no such file.
    // Same reasoning as `backend/conftest.py`'s env-file fixture.
    env: { VITE_API_URL: "" },
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: false,
  },
});
