import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolate browser/build verification from an already-running development server.
  distDir: process.env.SIGNALROOM_BUILD_DIR ?? ".next",
  // The floating dev badge sits on top of the sidebar's collapse control.
  devIndicators: false,

  // §103 — baseline security headers. A production deployment should add HSTS
  // and a CSP tuned to whichever analytics/AI providers are actually enabled.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
