'use client';

import NoSSRWrapper from "@/components/NoSSRWrapper";
import HomeSimplified from "./HomeSimplified";
import { useEffect, useState } from "react";
import { getDictionary } from "@/i18n/dictionaries";
import { Locale } from "@/i18n/config";

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default function Page({ params }: PageProps) {
  const [dictionary, setDictionary] = useState<any>(null);

  useEffect(() => {
    params.then(({ locale }) => {
      getDictionary(locale).then(dict => {
        setDictionary(dict);
      });
    });
  }, [params]);

  if (!dictionary) {
    return null;
  }

  return (
    <NoSSRWrapper>
      <HomeSimplified dictionary={dictionary} browserNotice={dictionary.browserNotice} />
    </NoSSRWrapper>
  );
}