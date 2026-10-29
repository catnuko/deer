import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cp } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

/**
 * foliate 的 pdf.js 用 `new URL(\`vendor/pdfjs/${path}\`, import.meta.url)`
 * 拼资源路径（worker / cmaps / standard_fonts / 样式表）。Vite 无法静态分析
 * 这种模板字符串，构建后这些文件不会进 dist；这里把目录拷到相对位置
 * （pdf 代码块落在 dist/assets/，所以目标是 dist/assets/vendor/pdfjs）。
 * dev 模式下 Vite 直接按源码目录提供，不需要拷贝。
 */
function copyFoliatePdfAssets() {
  return {
    name: "copy-foliate-pdfjs",
    apply: "build" as const,
    async closeBundle() {
      await cp(
        path.resolve(process.cwd(), "src/vendor/foliate-js/vendor/pdfjs"),
        path.resolve(process.cwd(), "dist/assets/vendor/pdfjs"),
        { recursive: true },
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), copyFoliatePdfAssets()],

  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
