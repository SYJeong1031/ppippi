import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PPI — 말 대신, 숫자.",
  description: "나만의 번호로 주고받는 디지털 삐삐",
  icons: { icon: "/favicon.svg", apple: "/icon-192.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PPI", statusBarStyle: "default" },
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#344837",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
