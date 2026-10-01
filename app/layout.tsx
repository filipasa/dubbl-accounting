import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/shared/theme-provider";
import "fumadocs-ui/style.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.fixbooks.io";

export const metadata: Metadata = {
  title: {
    default: "fixbooks · Accounting, ERP & Business Management",
    template: "%s · fixbooks",
  },
  description:
    "Double-entry accounting with invoicing, bills, payroll, inventory, projects, and CRM. Cloud Hosted. API-first, MCP-ready, Apache 2.0.",
  metadataBase: new URL(APP_URL),
  keywords: [
    "cloud accounting",
    "double-entry bookkeeping",
    "invoicing software",
    "accounts payable",
    "accounts receivable",
    "general ledger",
    "ERP",
    "payroll software",
    "inventory management",
    "project management",
    "CRM",
    "cloud-hosted accounting",
    "API-first accounting",
    "small business accounting",
    "free accounting software",
  ],
  authors: [{ name: "fixbooks", url: APP_URL }],
  creator: "fixbooks",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: APP_URL,
    siteName: "fixbooks",
    title: "fixbooks · Accounting & Business Management",
    description:
      "Double-entry accounting with invoicing, bills, payroll, inventory, projects, and CRM. Cloud Hosted.",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "fixbooks - Accounting for modern teams",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "fixbooks · Accounting & Business Management",
    description:
      "Double-entry accounting with invoicing, bills, payroll, inventory, projects, and CRM. Cloud Hosted.",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "fixbooks - Accounting for modern teams",
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/logo.svg",
    apple: "/web-app-manifest-192x192.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-title" content="Fixbooks" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <RootProvider>
            <SessionProvider>{children}</SessionProvider>
          </RootProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
