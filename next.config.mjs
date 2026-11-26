/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const explicitProjectId =
  process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!explicitProjectId && process.env.VERCEL_ENV === "production") {
  throw new Error(
    "Thiếu FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID cho môi trường production."
  );
}

const firebaseProjectId = explicitProjectId || (isDev ? "cho-pass-sv-dev" : "cho-pass-sv");

const configuredBuckets = Array.from(
  new Set(
    [
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      process.env.FIREBASE_STORAGE_BUCKET,
      `${firebaseProjectId}.firebasestorage.app`,
      `${firebaseProjectId}.appspot.com`,
      "cho-pass-sv.firebasestorage.app",
      "cho-pass-sv.appspot.com",
    ].filter(Boolean)
  )
);

const cloudinaryCloudName = (
  process.env.CLOUDINARY_CLOUD_NAME ||
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
  ""
).trim();

const remotePatterns = [
  ...configuredBuckets.flatMap((bucket) => [
    {
      protocol: "https",
      hostname: "firebasestorage.googleapis.com",
      pathname: `/v0/b/${bucket}/**`,
    },
    {
      protocol: "https",
      hostname: "storage.googleapis.com",
      pathname: `/${bucket}/**`,
    },
  ]),
  {
    protocol: "https",
    hostname: "res.cloudinary.com",
    pathname: cloudinaryCloudName ? `/${cloudinaryCloudName}/image/upload/**` : "/**/image/upload/**",
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

const cspScriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://accounts.google.com"
  : "'self' 'unsafe-inline' https://apis.google.com https://accounts.google.com";

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
              `default-src 'self'; script-src ${cspScriptSrc}; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://firebasestorage.googleapis.com https://api.cloudinary.com https://accounts.google.com; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; img-src 'self' blob: data: https://res.cloudinary.com https://firebasestorage.googleapis.com https://storage.googleapis.com https://images.unsplash.com https://lh3.googleusercontent.com; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self';`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
