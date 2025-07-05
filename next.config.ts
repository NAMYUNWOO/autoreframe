import type { NextConfig } from "next";
import path from 'path';

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, 'src'),
      'MediaInfoModule.wasm': path.resolve(__dirname, 'public/MediaInfoModule.wasm'),
    };
    
    // Handle ONNX files
    config.module.rules.push({
      test: /\.onnx$/,
      type: 'asset/resource',
    });
    
    // Configure for ONNX Runtime Web
    config.resolve.fallback = {
      ...config.resolve.fallback,
      path: false,
      fs: false,
      crypto: false,
    };
    
    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    
    
    // Ignore mediainfo.js on server side to avoid SSR issues
    if (isServer) {
      config.externals = [...(config.externals || []), 'mediainfo.js'];
    }
    
    return config;
  },
  
};

export default nextConfig;
