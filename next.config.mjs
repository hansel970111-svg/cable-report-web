import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: 'next-build',
  env: {
    CABLE_REPORT_APP_VERSION: packageJson.version,
  },
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lf-coze-web-cdn.coze.cn',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
