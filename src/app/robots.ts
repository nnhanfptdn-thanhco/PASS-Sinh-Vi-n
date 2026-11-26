import { MetadataRoute } from "next";

function getSiteUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://chopass.vn");
  return configured.replace(/\/+$/, "");
}

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/settings/",
        "/messages/",
        "/my-listings/",
        "/notifications/",
        "/reservations/",
        "/showcase",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
