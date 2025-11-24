import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  if (!env.VITE_ANTHROPIC_API_KEY) {
    console.warn(
      "\n⚠️  Warning: VITE_ANTHROPIC_API_KEY not found in .env file\n"
    );
  }

  return {
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
    server: {
      proxy: {
        "/api/claude": {
          target: "https://api.anthropic.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/claude/, ""),
          configure: (proxy, _options) => {
            proxy.on("proxyReq", (proxyReq, _req, _res) => {
              proxyReq.setHeader("x-api-key", env.VITE_ANTHROPIC_API_KEY || "");
              proxyReq.setHeader("anthropic-version", "2023-06-01");
            });
          },
        },
      },
    },
  };
});
