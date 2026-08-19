import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure Node code (Express/Prisma/BullMQ) — no DOM needed.
    environment: "node",

    // Only pick up real vitest specs (*.test.js). Co-located next to source.
    include: ["src/**/*.test.js", "tests/**/*.test.js"],

    // The throwaway manual scripts in src/test/ are NOT vitest specs — they're
    // named test-*.js (prefix), not *.test.js (suffix), so the include pattern
    // already skips them. We exclude the folder anyway so a stray rename can't
    // accidentally drag them into the automated suite.
    exclude: ["**/node_modules/**", "src/test/**"],
  },
});
