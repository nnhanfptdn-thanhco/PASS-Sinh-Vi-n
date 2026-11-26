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
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Chợ Pass SV",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    siteName: "Chợ Pass Sinh Viên",
    locale: "vi_VN",
    type: "website",
    title: "Chợ Pass Sinh Viên - Chợ đồ cũ sinh viên toàn quốc",
    description: "Nền tảng mua bán và pass đồ cũ dành riêng cho sinh viên Việt Nam.",
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: "Chợ Pass Sinh Viên" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-default.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
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
        className={`${beVietnamPro.variable} ${plusJakartaSans.variable} min-h-[100dvh] bg-background text-text-main flex flex-col font-body antialiased`}
      >
        <AuthProvider>
          <LegacyStorageCleanup />
          <Header />
          <main className="flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-8">{children}</main>
          <MobileBottomNav />
        </AuthProvider>
      </body>
    </html>
  );
}
