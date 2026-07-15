import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["dist/**", "dist-electron/**", "node_modules/**"],
  },
});
