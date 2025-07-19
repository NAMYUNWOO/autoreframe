export const locales = ['en', 'ko', 'ja', 'zh', 'id', 'hi', 'es'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  zh: '中文',
  id: 'Bahasa Indonesia',
  hi: 'हिन्दी',
  es: 'Español'
};

export const localeRegions: Record<Locale, string> = {
  en: 'en_US',
  ko: 'ko_KR',
  ja: 'ja_JP',
  zh: 'zh_CN',
  id: 'id_ID',
  hi: 'hi_IN',
  es: 'es_ES'
};