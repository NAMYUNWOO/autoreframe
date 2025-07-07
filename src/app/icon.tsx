import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 32,
  height: 32,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 24,
          background: '#1a1a1a',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '6px',
        }}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          {/* Outer frame (landscape video) */}
          <rect x="4" y="8" width="24" height="16" rx="2" stroke="#3b82f6" strokeWidth="2" fill="none"/>
          
          {/* Inner frame (portrait crop) with dashed line */}
          <rect x="10" y="6" width="12" height="20" rx="2" stroke="#a855f7" strokeWidth="2" strokeDasharray="2 2" fill="none"/>
          
          {/* Center tracking dot */}
          <circle cx="16" cy="16" r="3" fill="#10b981"/>
          <circle cx="16" cy="16" r="1.5" fill="#1a1a1a"/>
          
          {/* Corner markers */}
          <path d="M11 7L11 9L13 9" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M21 7L21 9L19 9" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M11 25L11 23L13 23" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M21 25L21 23L19 23" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
    ),
    {
      ...size,
    }
  )
}