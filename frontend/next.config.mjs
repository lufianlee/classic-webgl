/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a standalone server bundle; copied into the runtime image so
  // the production container doesn't need node_modules at runtime.
  output: 'standalone',
  async rewrites() {
    // Reverse-proxy /api/* to the backend container. The browser hits the
    // same origin (the frontend), so we don't need CORS on the backend in
    // production — a big simplification over the dev setup.
    const upstream = process.env.BACKEND_INTERNAL_URL ?? 'http://backend:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${upstream}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
