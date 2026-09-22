import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    core: "src/core.ts",
    next: "src/next.ts",
    vercel: "src/vercel.ts",
    presets: "src/presets.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  platform: "neutral",
  external: ["@vercel/functions", "@vercel/functions/middleware"],
});
