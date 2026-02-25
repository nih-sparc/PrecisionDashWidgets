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
  build: {
    cssCodeSplit: false,
    copyPublicDir: false,
    lib: {
      entry: "./src/components/index.js",
      name: "precision-dashwidgets",
      fileName: (format) => `precision-dashwidgets.${format}.js`,
    },
    rollupOptions: {
      external: ["vue", "@aws-amplify/auth", "pinia", "element-plus"],
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
