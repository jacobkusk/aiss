import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/.well-known/merkle/:date',
        destination: '/api/merkle?date=:date',
      },
      {
        source: '/.well-known/merkle',
        destination: '/api/merkle?date=latest',
      },
    ]
  },
};

export default nextConfig;
