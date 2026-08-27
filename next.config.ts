import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * This is a single-user assistant holding intimate details about the people in
 * someone's life, on a public URL. The defaults are not enough.
 *
 * Note the Permissions-Policy: microphone must be allowed for `self`, or the
 * browser silently refuses speech recognition and the voice feature simply
 * stops working with no error anyone can see.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Nothing gained by advertising the framework version.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Nothing under /api should ever be cached — every route is either
        // personal data or an action.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          ...securityHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
