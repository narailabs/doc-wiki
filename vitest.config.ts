import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["agents/**/*.test.ts", "skills/**/*.test.ts", "benchmark/**/*.test.ts"],
    exclude: ["node_modules/**", ".worktrees/**", "wiki-workspace/**", "**/tests/fixtures/**"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      exclude: ["node_modules/**", ".worktrees/**", "wiki-workspace/**", "**/tests/fixtures/**"],
    },
  },
});
