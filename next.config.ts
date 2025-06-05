import type { NextConfig } from "next";
import path from 'path';

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, 'src'),
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
    
    return config;
  },
  
};

export default nextConfig;
