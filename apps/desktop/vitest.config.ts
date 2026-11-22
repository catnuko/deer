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
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**"],
      // 第三方 vendored 代码、演示书与测试脚手架不计入盲区度量。
      exclude: [
        "src/vendor/**",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "**/*.test.*",
        "**/*.config.*",
      ],
      // 阈值起步略低于当前水位（67/60/68/70），只拦明显回退，不硬凑数字；
      // 后续补测把水位抬高后再随手上调。
      thresholds: {
        statements: 65,
        branches: 58,
        functions: 65,
        lines: 68,
      },
    },
  },
});
