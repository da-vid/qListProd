import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: { target: "es2022", sourcemap: false },
  define: { __QLIST_MODE__: JSON.stringify(mode) },
}));
