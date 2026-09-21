import type { NextConfig } from 'next';
import { DESIGN_SCHEME_PACKAGE_LIMITS } from '@musefold/contracts';

// Web 与 API 同源部署(V25-ARCHITECTURE D8):浏览器只见单一 origin,
// 会话 cookie 走 sameSite=lax,API 无需 CORS。dev 下由 Next 反代到本地 API。
const API_UPSTREAM = process.env.MUSEFOLD_API_UPSTREAM ?? 'http://127.0.0.1:8787';
const APP_BASE_PATH = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
if (APP_BASE_PATH && !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(APP_BASE_PATH)) {
  throw new Error('Invalid application base path');
}

const nextConfig: NextConfig = {
  basePath: APP_BASE_PATH,
  reactCompiler: true,
  // Next clones rewrite request bodies; its 10 MiB default truncates valid scheme packages.
  // Admission, exact byte counts and concurrent upload limits remain enforced by the API.
  experimental: {
    proxyClientMaxBodySize: DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes,
  },
  // 自托管 Docker 部署(V25-ARCHITECTURE D8):standalone 输出。
  output: 'standalone',
  transpilePackages: ['@musefold/ui', '@musefold/features', '@musefold/platform'],
  // dev 指示器不入视觉快照(E2E 在 dev 模式跑)。
  devIndicators: false,
  // E2E 经 127.0.0.1 访问 dev server;Next 16 默认只放行 localhost。
  allowedDevOrigins: ['127.0.0.1'],
  // Web 构建标识(07-07 P3):只透传 CI/宿主环境变量,本地缺省为空、不 shell out 到 git。
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION ?? '',
    NEXT_PUBLIC_GIT_COMMIT: process.env.NEXT_PUBLIC_GIT_COMMIT ?? '',
    NEXT_PUBLIC_BUILT_AT: process.env.NEXT_PUBLIC_BUILT_AT ?? '',
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_UPSTREAM}${APP_BASE_PATH}/api/:path*` },
      { source: '/mcp/:path*', destination: `${API_UPSTREAM}${APP_BASE_PATH}/mcp/:path*` },
      {
        source: '/.well-known/:path*',
        destination: `${API_UPSTREAM}${APP_BASE_PATH}/.well-known/:path*`,
      },
    ];
  },
};

export default nextConfig;
