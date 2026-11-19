import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingDetailClient } from "./ListingDetailClient";
import { getPublicListingById } from "@/lib/services/listings";

export const dynamic = "force-dynamic";

// Server-side generateMetadata for Open Graph & SEO khi dán link vào Zalo/Facebook
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const data = await getPublicListingById(params.id);
  if (!data) {
    return {
      title: "Không tìm thấy tin đăng | Chợ Pass Sinh Viên",
      robots: { index: false },
    };
  }

  const { listing } = data;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");

  const formattedPrice =
    listing.price === 0 ? "Tặng miễn phí" : `${listing.price.toLocaleString("vi-VN")} đ`;

  return {
    title: `${listing.title} - ${formattedPrice}`,
    description: `${listing.description.slice(0, 150)}...`,
    openGraph: {
      title: `Pass đồ sinh viên: ${listing.title} - ${formattedPrice}`,
      description: `Đang pass tại ${listing.schoolName || "trường đại học"}. Nhấn để xem chi tiết và giữ chỗ ngay.`,
      url: `${siteUrl}/listings/${listing.id}`,
      siteName: "Chợ Pass Sinh Viên",
      images: [
        {
          url: listing.coverImage || listing.images[0] || "/og-default.png",
          width: 800,
          height: 600,
          alt: listing.title,
        },
      ],
      type: "article",
    },
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getPublicListingById(params.id);

  if (!data) {
    notFound();
  }

  return <ListingDetailClient listing={data.listing} seller={data.seller} />;
}
