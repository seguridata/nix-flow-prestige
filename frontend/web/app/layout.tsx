import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Prestige | SeguriData",
    template: "%s | Prestige",
  },
  description:
    "Prestige: la plataforma de firma electrónica y flujo documental de SeguriData. Confianza digital verificable.",
  icons: {
    icon: "/brand/favicon.png",
    apple: "/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${plexMono.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
