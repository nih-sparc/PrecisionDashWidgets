import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
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
    lib: {
      entry: './src/index.ts', 
      name: 'PrecisionDashWidgets',
      fileName: (format) => `PrecisionDashWidgets.${format}.js`,
    },
    rollupOptions: {
      //external dependencies 
      external: [
        'vue',
        '@aws-amplify/auth',
        'pinia'],
      output: {
        assetFileNames: (a) => a.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]',
        globals: {
          vue: 'Vue',
          pinia: 'Pinia', 
          '@aws-amplify/auth': 'aws_amplify_auth'
        },
      },
    },
  },
})
