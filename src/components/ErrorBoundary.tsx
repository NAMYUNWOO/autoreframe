'use client';

import { useEffect } from 'react';

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // console.error('Unhandled promise rejection:', event.reason);
      
      // Show user-friendly error message
      if (event.reason instanceof Error) {
        if (event.reason.message.includes('head_model')) {
          // console.warn('Head detection model failed to load, using fallback');
        }
      }
      
      // Prevent the default error handling
      event.preventDefault();
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return <>{children}</>;
}