'use client';

import { useState } from 'react';

interface ServiceShowcaseProps {
  className?: string;
}

export function ServiceShowcase({ className = '' }: ServiceShowcaseProps) {
  const [isPlaying, setIsPlaying] = useState({ original: false, reframed: false });

  return (
    <div className={`w-full ${className}`}>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-white mb-3">
          See AutoReframer in Action
        </h2>
        <p className="text-gray-400 text-lg">
          Transform your landscape videos into vertical format for social media
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Original Video */}
        <div className="space-y-3">
          <h3 className="text-center text-white font-semibold">
            Original Video with Person Tracking
          </h3>
          <div className="relative bg-black rounded-lg overflow-hidden shadow-2xl">
            <video
              src="/tracking.webm"
              className="w-full"
              loop
              muted
              playsInline
              autoPlay
              onMouseEnter={(e) => {
                e.currentTarget.play();
                setIsPlaying(prev => ({ ...prev, original: true }));
              }}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                setIsPlaying(prev => ({ ...prev, original: false }));
              }}
            />
            <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <span className="text-xs text-white flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                AI Tracking Active
              </span>
            </div>
          </div>
          <p className="text-center text-sm text-gray-400">
            Our AI detects and tracks the selected person throughout the video
          </p>
        </div>

        {/* Reframed Video with Social Media Frame */}
        <div className="space-y-3">
          <h3 className="text-center text-white font-semibold">
            Reframed for Instagram/TikTok
          </h3>
          <div className="relative">
            {/* Phone Frame */}
            <div className="relative mx-auto" style={{ maxWidth: '320px' }}>
              {/* Phone Shell */}
              <div className="relative bg-black rounded-[2.5rem] p-2 shadow-2xl">
                {/* Screen */}
                <div className="relative bg-black rounded-[2rem] overflow-hidden">
                  {/* Status Bar */}
                  <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/50 to-transparent px-6 py-2">
                    <div className="flex justify-between items-center text-white text-xs">
                      <span>9:41</span>
                      <div className="flex gap-1">
                        <svg className="w-4 h-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M2 17h20v2H2zm1.15-4.05L4 11.47l.85 1.48 1.3-.75-.85-1.48H7v-1.5H5.3l.85-1.48L4.85 7 4 8.47 3.15 7l-1.3.75.85 1.48H1v1.5h1.7l-.85 1.48 1.3.75zm6.7-.75l1.48.85 1.48-.85-.85-1.48H14v-1.5h-2.05l.85-1.48-1.48-.85L10 8.47 8.68 7l-1.48.85.85 1.48H6v1.5h2.05l-.85 1.48zm8 0l1.48.85 1.48-.85-.85-1.48H22v-1.5h-2.05l.85-1.48-1.48-.85L18 8.47 16.68 7l-1.48.85.85 1.48H14v1.5h2.05l-.85 1.48z"/>
                        </svg>
                        <svg className="w-4 h-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M1 9l2-2v8a2 2 0 002 2h14a2 2 0 002-2V7l2 2V2L1 2v7z"/>
                        </svg>
                        <svg className="w-6 h-3" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="2" y="6" width="18" height="12" rx="2"/>
                          <rect x="20" y="9" width="2" height="6"/>
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Video Content */}
                  <video
                    src="/reframed_tracking.webm"
                    className="w-full"
                    style={{ aspectRatio: '9/16' }}
                    loop
                    muted
                    playsInline
                    autoPlay
                    onMouseEnter={(e) => {
                      e.currentTarget.play();
                      setIsPlaying(prev => ({ ...prev, reframed: true }));
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      setIsPlaying(prev => ({ ...prev, reframed: false }));
                    }}
                  />

                  {/* Bottom Navigation */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                    <div className="flex justify-around items-center text-white">
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                      </svg>
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <div className="relative">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <rect x="5" y="5" width="14" height="14" rx="2" strokeWidth={2}/>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v6m-3-3h6" />
                        </svg>
                      </div>
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20.285 2l-11.285 11.567-5.286-5.011-3.714 3.716 9 8.728 15-15.285z"/>
                      </svg>
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                      </svg>
                    </div>
                  </div>

                  {/* Social Media Overlay */}
                  <div className="absolute right-3 bottom-20 flex flex-col gap-4 items-center">
                    <div className="text-center">
                      <div className="w-10 h-10 bg-white rounded-full mb-1"></div>
                      <svg className="w-6 h-6 text-red-500 -mt-3 mx-auto" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                      </svg>
                    </div>
                    <div className="text-center">
                      <svg className="w-8 h-8 text-white mb-1" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                      <span className="text-white text-xs">2.1K</span>
                    </div>
                    <div className="text-center">
                      <svg className="w-8 h-8 text-white mb-1" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
                      </svg>
                      <span className="text-white text-xs">Share</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Home Indicator */}
              <div className="mt-2 mx-auto w-32 h-1 bg-white/30 rounded-full"></div>
            </div>
          </div>
          <p className="text-center text-sm text-gray-400">
            Perfect for Instagram Reels, TikTok, and YouTube Shorts
          </p>
        </div>
      </div>

      <div className="mt-8 text-center">
        <p className="text-gray-400">
          <span className="text-blue-400 font-semibold">Try it now!</span> Upload your video above to get started
        </p>
      </div>
    </div>
  );
}