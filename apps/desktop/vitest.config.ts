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
      // v8 覆盖率：CI 跑 `pnpm run test:coverage` 产出报告，盲区可度量
      // （《Deer 项目现状报告》§4.6）。all: true 把没被任何测试碰过的
      // 文件也算进来，否则「盲区规模」看不见。
      provider: "v8",
      all: true,
      include: ["src/**"],
      exclude: [
        // vendored 上游代码不覆盖（VENDORED.md 约定不改）。
        "src/vendor/**",
        // 测试基建与入口。
        "src/test/**",
        "src/main.tsx",
        // 测试文件本身与纯类型声明。
        "**/*.test.*",
        "**/*.d.ts",
      ],
      reporter: ["text", "html"],
      thresholds: {
        // 起步阈值：略低于当前实际水位（lines ~70 / branches ~60），
        // 只防倒退，不硬凑数字。
        lines: 68,
        functions: 65,
        statements: 65,
        branches: 58,
      },
    },
  },
});
