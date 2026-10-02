import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  cacheDir: mode === "photo-preview" ? ".photo-cache" : "node_modules/.vite",
  plugins:
    mode === "photo-preview"
      ? [
          {
            name: "local-photo-route",
            configureServer(server) {
              server.middlewares.use((req, _res, next) => {
                if (
                  req.method === "GET" &&
                  ["/", "/PhotoDemo"].includes((req.url ?? "").split("?")[0])
                )
                  req.url = "/photos.html";
                next();
              });
            },
          },
        ]
      : [],
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: { target: "es2022", sourcemap: false },
  define: { __QLIST_MODE__: JSON.stringify(mode) },
}));
