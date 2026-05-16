/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "arweave.net"
      },
      {
        protocol: "https",
        hostname: "gateway.irys.xyz"
      }
    ]
  }
};

export default nextConfig;
