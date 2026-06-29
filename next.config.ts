import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  // Use experimental flag for advanced features
  experimental: {
    // Optimize for single-page applications
    optimizePackageImports: ['react', 'react-dom'],
    // Use server actions for better browser compatibility
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
