import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/navigation/Header";
import { MobileBottomNav } from "@/components/navigation/MobileBottomNav";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { LegacyStorageCleanup } from "@/components/common/LegacyStorageCleanup";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-vietnam",
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Chợ Pass Sinh Viên - Chợ đồ cũ sinh viên toàn quốc",
    template: "%s | Chợ Pass Sinh Viên",
  },
  description:
    "Nền tảng mua bán và pass đồ cũ dành riêng cho sinh viên Việt Nam: quạt, nồi cơm, bàn học, giáo trình, xe cộ. Người đăng tin là sinh viên đã xác thực.",
  openGraph: {
    siteName: "Chợ Pass Sinh Viên",
    locale: "vi_VN",
    type: "website",
    title: "Chợ Pass Sinh Viên - Chợ đồ cũ sinh viên toàn quốc",
    description: "Nền tảng mua bán và pass đồ cũ dành riêng cho sinh viên Việt Nam.",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body
        className={`${beVietnamPro.variable} ${plusJakartaSans.variable} min-h-screen bg-background text-text-main flex flex-col font-body antialiased`}
      >
        <AuthProvider>
          <LegacyStorageCleanup />
          <Header />
          <main className="flex-1 pb-20 md:pb-8">{children}</main>
          <MobileBottomNav />
        </AuthProvider>
      </body>
    </html>
  );
}
