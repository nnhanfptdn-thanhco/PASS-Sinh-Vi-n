import * as React from "react";
import type { Metadata } from "next";
import { ListingDetailClient } from "./ListingDetailClient";
import universitiesData from "../../../../data/universities_vietnam.json";

// Server-side generateMetadata for Open Graph & SEO khi dán link vào Zalo/Facebook
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const listingId = params.id;
  const school = universitiesData[0];

  return {
    title: `Quạt đứng Senko công suất lớn - Chợ Pass Sinh Viên (${school.shortName})`,
    description: `Pass đồ cũ sinh viên uy tín tại ${school.name}. Giá 180.000 đ. Đã xác thực thẻ sinh viên 100%.`,
    openGraph: {
      title: `Pass đồ sinh viên: Quạt đứng Senko - 180.000 đ`,
      description: `Đang pass gấp tại ${school.shortName}. Nhấn để xem chi tiết và giữ chỗ ngay.`,
      url: `https://chopass.vn/listings/${listingId}`,
      siteName: "Chợ Pass Sinh Viên",
      images: [
        {
          url: "https://images.unsplash.com/photo-1618941709405-b0b30bb63214?w=800&auto=format&fit=crop&q=80",
          width: 800,
          height: 600,
          alt: "Ảnh món đồ pass",
        },
      ],
      type: "article",
    },
  };
}

export default function ListingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const listing = {
    id: params.id,
    title: "Quạt đứng Senko công suất lớn lồng sóc màu xám còn rất mới",
    price: 180000,
    originalPrice: 350000,
    urgentPass: true,
    condition: "Như mới (còn trên 90%)",
    brandModel: "Senko DR1608",
    usageTime: "6 tháng (1 học kỳ)",
    defects: "Không có lỗi (hoạt động êm ái, cánh quạt sạch sẽ)",
    description:
      "Mình là sinh viên năm cuối K21 Bách Khoa chuẩn bị dọn phòng trọ về quê nên pass lại quạt Senko. Quạt mua mới ở Điện Máy Xanh, có điều khiển từ xa, 3 tốc độ gió, chạy cực êm không kêu rè rè. Tặng kèm cho bạn nào mua nhanh ổ cắm điện 3 chấu.",
    images: [
      "https://images.unsplash.com/photo-1618941709405-b0b30bb63214?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80",
    ],
    negotiationType: "slight",
    passDeadline: "20/11/2026",
    schoolCode: "QSX",
    schoolName: "Trường Đại học Bách khoa - ĐHQG TP.HCM",
    campusName: "Cơ sở 1 (Lý Thường Kiệt, Q.10)",
    publicMeetingPoint: "Cổng 1 Lý Thường Kiệt hoặc Căn tin A3",
    seller: {
      id: "seller-123",
      displayName: "Tuấn Anh (K21 Bách Khoa)",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
      verified: true,
      rating: 4.9,
      completedDealsCount: 8,
      joinDate: "Tháng 09/2025",
      isGraduating: true,
    },
    shipping: {
      allowPickup: true,
      pickupSchedule: "Tất cả các buổi chiều từ 16h30 - 20h00",
      allowSellerShip: true,
      shipFee: "Freeship bán kính 2km quanh ĐH Bách Khoa",
      allowCarrier: false,
      campusDelivery: true,
    },
  };

  return <ListingDetailClient listing={listing} />;
}
