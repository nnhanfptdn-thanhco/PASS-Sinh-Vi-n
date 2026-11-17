import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/navigation/Header";
import { MobileBottomNav } from "@/components/navigation/MobileBottomNav";

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

export const metadata: Metadata = {
  title: "Chợ Pass Sinh Viên - Chợ đồ cũ sinh viên toàn quốc",
  description:
    "Nền tảng mua bán và pass đồ cũ uy tín dành riêng cho sinh viên Việt Nam: quạt, nồi cơm, bàn học, giáo trình, xe cộ. Đã xác minh thẻ sinh viên 100%.",
  keywords: [
    "chợ pass sinh viên",
    "pass đồ sinh viên",
    "đồ cũ sinh viên",
    "giáo trình cũ",
    "quạt nồi cơm sinh viên",
  ],
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
        <Header />
        <main className="flex-1 pb-20 md:pb-8">{children}</main>
        <MobileBottomNav />
      </body>
    </html>
  );
}
