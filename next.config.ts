import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Correction evidence is uploaded through a server action.
      // The bucket enforces the same 6 MB limit.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
