import { Locale } from './config';

export interface Dictionary {
  common: {
    title: string;
    description: string;
    upload: string;
    processing: string;
    download: string;
    selectPerson: string;
    reframe: string;
    export: string;
  };
  home: {
    title: string;
    subtitle: string;
    aiEngineLoading: string;
    pleaseWait: string;
    firstVisitDownload: string;
  };
  seo: {
    title: string;
    description: string;
    keywords: string;
  };
  features: {
    aiPowered: string;
    personTracking: string;
    multipleAspectRatios: string;
    noWatermark: string;
    clientSideProcessing: string;
    exportToMp4: string;
  };
  browserNotice: {
    title: string;
    description: string;
    recommendation: string;
  };
  personGallery: {
    title: string;
    subtitle: string;
    detectingPeople: string;
    noPeopleFound: string;
    clickToPreview: string;
    person: string;
  };
  personPreview: {
    selectThisPerson: string;
    cancel: string;
    swipeToNavigate: string;
  };
  autoProcessing: {
    detectingVideo: string;
    calculatingReframe: string;
    preparingPreview: string;
    almostDone: string;
  };
  result: {
    save: string;
    share: string;
    selectAnother: string;
    processing: string;
    selectQuality: string;
    qualityGood: string;
    qualityBetter: string;
    qualityBest: string;
    shareNotSupported: string;
    iosSaveInstructions: string;
  };
}

const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  en: () => import('./locales/en.json').then((module) => module.default),
  ko: () => import('./locales/ko.json').then((module) => module.default),
  ja: () => import('./locales/ja.json').then((module) => module.default),
  zh: () => import('./locales/zh.json').then((module) => module.default),
  id: () => import('./locales/id.json').then((module) => module.default),
  hi: () => import('./locales/hi.json').then((module) => module.default),
  es: () => import('./locales/es.json').then((module) => module.default),
};

export const getDictionary = async (locale: Locale): Promise<Dictionary> => {
  return dictionaries[locale]();
};