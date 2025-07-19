'use client';

import NoSSRWrapper from "@/components/NoSSRWrapper";
import Home from "./Home";
import { BrowserOptimizationNotice } from "@/components/BrowserOptimizationNotice";
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
    return null; // Or a loading state
  }
  
  return (
    <NoSSRWrapper>
      <div className="container mx-auto px-4 py-8">
        <BrowserOptimizationNotice dictionary={dictionary.browserNotice} />
        <Home dictionary={dictionary} />
      </div>
    </NoSSRWrapper>
  );
}