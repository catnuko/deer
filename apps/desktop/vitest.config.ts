import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// 组件测试专用配置。存在本文件后 vitest 不再读 vite.config.ts：
// 默认环境仍是 node（现有 store/纯逻辑测试行为不变），
// 组件测试用文件内 `@vitest-environment happy-dom` 注释声明 DOM 环境。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },
});
