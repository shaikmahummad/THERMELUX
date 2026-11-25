import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/three/")) return "three";
          if (id.includes("/node_modules/@react-three/fiber/")) return "react-three-fiber";
          if (id.includes("/node_modules/@react-three/drei/")) return "react-three-drei";
          if (id.includes("/node_modules/three-stdlib/")) return "three-stdlib";
        },
      },
    },
  },
});
