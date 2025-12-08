import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Analytics } from "@vercel/analytics/next";
import { GoogleTagManager, GoogleTagManagerNoscript } from "@/components/GoogleTagManager";
import { locales, localeRegions, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

type Props = {
  params: Promise<{ locale: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: localeParam } = await params;
  const locale = (locales.includes(localeParam as Locale) ? localeParam : 'en') as Locale;
  const dict = await getDictionary(locale);
  
  const alternateLanguages = locales.reduce((acc, loc) => {
    if (loc !== locale) {
      acc[loc] = `/${loc}`;
    }
    return acc;
  }, {} as Record<string, string>);

  return {
    title: dict.seo.title,
    description: dict.seo.description,
    keywords: dict.seo.keywords,
    authors: [{ name: "AutoReframer Team" }],
    creator: "AutoReframer",
    publisher: "AutoReframer",
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ...alternateLanguages,
        'x-default': '/en',
      },
    },
    openGraph: {
      title: dict.seo.title,
      description: dict.seo.description,
      url: `https://www.auto-reframe.com/${locale}`,
      siteName: "AutoReframer",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "AutoReframer - AI Video Reframing Tool",
        },
      ],
      locale: localeRegions[locale],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: dict.seo.title,
      description: dict.seo.description,
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
}

export default async function LocaleLayout({
  children,
  params,
}: Props) {
  const { locale: localeParam } = await params;
  const locale = (locales.includes(localeParam as Locale) ? localeParam : 'en') as Locale;
  const dict = await getDictionary(locale);

  return (
    <html lang={locale}>
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
              "description": dict.common.description,
              "url": `https://www.auto-reframe.com/${locale}`,
              "applicationCategory": "MultimediaApplication",
              "operatingSystem": "Web Browser",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "featureList": [
                dict.features.aiPowered,
                dict.features.personTracking,
                dict.features.multipleAspectRatios,
                dict.features.noWatermark,
                dict.features.clientSideProcessing,
                dict.features.exportToMp4
              ],
              "screenshot": "https://www.auto-reframe.com/og-image.png",
              "inLanguage": locale
            })
          }}
        />
      </body>
    </html>
  );
}
