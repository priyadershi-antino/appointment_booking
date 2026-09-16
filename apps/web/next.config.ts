import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The shared contract package ships TypeScript source, so Next compiles it with the app.
  transpilePackages: ['@booking/shared'],
};

export default config;
