import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // api2's CORS allowlist includes localhost:3000 but not Vite's default 5173
    port: 3000,
    strictPort: true,
  },
  build: {
    cssCodeSplit: false,
    copyPublicDir: false,
    lib: {
      entry: "./src/components/index.js",
      name: "precision-dashwidgets",
      fileName: (format) => `precision-dashwidgets.${format}.js`,
    },
    rollupOptions: {
      // core is a peer: the host app provides one shared copy. Its style.css is a separate
      // module id, so it is still bundled into this lib's style.css.
      external: ["vue", "@aws-amplify/auth", "pinia", "element-plus", "@pennsieve-viz/core"],
      output: {
        assetFileNames: (a) =>
          a.name?.endsWith(".css") ? "style.css" : "assets/[name][extname]",
        globals: {
          vue: "Vue",
          pinia: "Pinia",
          "@aws-amplify/auth": "aws_amplify_auth",
          "element-plus": "ElementPlus",
        },
      },
    },
  },
});
