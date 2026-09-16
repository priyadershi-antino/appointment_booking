import type { NextConfig } from 'next';

/**
 * Where this server forwards API calls. It is a server-side value, not baked into the
 * browser bundle, so the API can be moved without rebuilding the client.
 */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  // The shared contract package ships TypeScript source, so Next compiles it with the app.
  transpilePackages: ['@booking/shared'],

  /**
   * The API is served from the web app's own origin.
   *
   * This exists for the session cookie. Auth is an httpOnly cookie, and a cookie set by
   * an API on another domain is a third-party cookie — blocked outright by Safari and by
   * default in Chrome. Proxying makes it first-party, which is the only arrangement that
   * works in every browser, and it drops the CORS preflight on every request as well.
   *
   * The API prefix is mirrored here; keep it in step with API_PREFIX on the API.
   */
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiTarget}/api/v1/:path*`,
      },
    ];
  },
};

export default config;
