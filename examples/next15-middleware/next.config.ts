import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets the smoke test build into a separate folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
