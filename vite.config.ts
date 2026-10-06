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
    proxy: {
      "/api2": {
        target: "https://api2.pennsieve.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api2/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("cookie");
          });
        },
      },
      "/assets-proxy": {
        target: "https://assets.pennsieve.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/assets-proxy/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("cookie");
          });
        },
      },
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
      external: [
        "vue",
        "@aws-amplify/auth",
        "pinia",
        "element-plus",
        "@deck.gl/core",
        "@deck.gl/layers",
        "@deck.gl/extensions",
        "@deck.gl/geo-layers",
        "@deck.gl/mesh-layers",
        "@luma.gl/core",
        "@luma.gl/engine",
        "@luma.gl/constants",
        "@luma.gl/shadertools",
        "@luma.gl/webgl",
      ],
      output: {
        assetFileNames: (a) =>
          a.name?.endsWith(".css") ? "style.css" : "assets/[name][extname]",
        globals: {
          vue: "Vue",
          pinia: "Pinia",
          "@aws-amplify/auth": "aws_amplify_auth",
          "element-plus": "ElementPlus",
          "@deck.gl/core": "deck",
          "@deck.gl/layers": "deck",
          "@deck.gl/extensions": "deck",
          "@deck.gl/geo-layers": "deck",
          "@deck.gl/mesh-layers": "deck",
          "@luma.gl/core": "luma",
          "@luma.gl/engine": "luma",
          "@luma.gl/constants": "luma",
          "@luma.gl/shadertools": "luma",
          "@luma.gl/webgl": "luma",
        },
      },
    },
  },
});
