/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const firebaseProjectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  (isDev ? "cho-pass-sv-dev" : undefined);

if (!firebaseProjectId && process.env.VERCEL_ENV === "production") {
  throw new Error(
    "Thiếu FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID cho môi trường production."
  );
}

const remotePatterns = [
  {
    protocol: "https",
    hostname: "firebasestorage.googleapis.com",
  },
  {
    protocol: "https",
    hostname: "storage.googleapis.com",
  },
  {
    protocol: "https",
    hostname: "images.unsplash.com",
  },
  {
    protocol: "https",
    hostname: "lh3.googleusercontent.com",
  },
];

if (isDev) {
  remotePatterns.push(
    {
      protocol: "http",
      hostname: "127.0.0.1",
    },
    {
      protocol: "http",
      hostname: "localhost",
    }
  );
}

const nextConfig = {
  images: {
    remotePatterns,
  },
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${firebaseProjectId}.firebaseapp.com/__/auth/:path*`,
      },
      {
        source: "/__/firebase/init.json",
        destination: `https://${firebaseProjectId}.firebaseapp.com/__/firebase/init.json`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/api/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://accounts.google.com; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://firebasestorage.googleapis.com https://accounts.google.com; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; img-src 'self' blob: data: https://firebasestorage.googleapis.com https://storage.googleapis.com https://images.unsplash.com https://lh3.googleusercontent.com; style-src 'self' 'unsafe-inline'; font-src 'self';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
