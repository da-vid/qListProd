import { build } from "vite";
await build({
  mode: "photo-preview",
  build: { outDir: "dist-photos", rollupOptions: { input: "photos.html" } },
});
