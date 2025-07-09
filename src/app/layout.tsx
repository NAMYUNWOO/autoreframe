import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Analytics } from "@vercel/analytics/next";
import { GoogleTagManager, GoogleTagManagerNoscript } from "@/components/GoogleTagManager";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoReframer - AI Video Reframing Tool | Auto Crop Videos for Social Media",
  description: "Free online AI-powered video reframing tool. Automatically crop and resize videos for Instagram, TikTok, YouTube Shorts. Smart person tracking, aspect ratio conversion (16:9, 9:16, 1:1), no watermark.",
  keywords: "video reframing, AI video crop, auto crop video, resize video for Instagram, TikTok video resizer, YouTube Shorts converter, aspect ratio converter, person tracking, video editing tool, free video editor",
  authors: [{ name: "AutoReframer Team" }],
  creator: "AutoReframer",
  publisher: "AutoReframer",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://www.auto-reframe.com"),
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: "AutoReframer - AI Video Reframing Tool",
    description: "Free AI-powered tool to automatically reframe videos for social media. Smart person tracking, multiple aspect ratios, no watermark.",
    url: "https://www.auto-reframe.com",
    siteName: "AutoReframer",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AutoReframer - AI Video Reframing Tool",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoReframer - AI Video Reframing Tool",
    description: "Free AI tool to automatically reframe videos for social media platforms",
    images: ["/og-image.png"],
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <GoogleTagManager />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <GoogleTagManagerNoscript />
        <ErrorBoundary>
          {children}
          <Analytics />
        </ErrorBoundary>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "AutoReframer",
              "description": "AI-powered video reframing tool for social media",
              "url": "https://www.auto-reframe.com",
              "applicationCategory": "MultimediaApplication",
              "operatingSystem": "Web Browser",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "featureList": [
                "AI person detection and tracking",
                "Automatic video reframing",
                "Multiple aspect ratio support (16:9, 9:16, 1:1, 4:5)",
                "No watermark",
                "Client-side processing",
                "Export to MP4"
              ],
              "screenshot": "https://www.auto-reframe.com/og-image.png"
            })
          }}
        />
      </body>
    </html>
  );
}
