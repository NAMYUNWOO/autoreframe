import { MetadataRoute } from 'next';
import { locales, defaultLocale } from '@/i18n/config';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://www.auto-reframe.com';
  const currentDate = new Date().toISOString();
  
  // Generate URLs for all locales
  const urls = locales.flatMap((locale) => {
    const url = locale === defaultLocale ? baseUrl : `${baseUrl}/${locale}`;
    
    return {
      url,
      lastModified: currentDate,
      changeFrequency: 'weekly' as const,
      priority: locale === defaultLocale ? 1 : 0.9,
      alternates: {
        languages: locales.reduce((acc, loc) => {
          if (loc === defaultLocale) {
            acc['x-default'] = baseUrl;
            acc[loc] = baseUrl;
          } else {
            acc[loc] = `${baseUrl}/${loc}`;
          }
          return acc;
        }, {} as Record<string, string>),
      },
    };
  });
  
  return urls;
}