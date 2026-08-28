import type { NextConfig } from 'next';

// Web 与 API 同源部署(V25-ARCHITECTURE D8):浏览器只见单一 origin,
// 会话 cookie 走 sameSite=lax,API 无需 CORS。dev 下由 Next 反代到本地 API。
const API_UPSTREAM = process.env.MUSEFOLD_API_UPSTREAM ?? 'http://127.0.0.1:8787';

const nextConfig: NextConfig = {
  reactCompiler: true,
  // 自托管 Docker 部署(V25-ARCHITECTURE D8):standalone 输出。
  output: 'standalone',
  transpilePackages: ['@musefold/ui', '@musefold/features', '@musefold/platform'],
  // dev 指示器不入视觉快照(E2E 在 dev 模式跑)。
  devIndicators: false,
  // E2E 经 127.0.0.1 访问 dev server;Next 16 默认只放行 localhost。
  allowedDevOrigins: ['127.0.0.1'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_UPSTREAM}/api/:path*` },
      { source: '/mcp/:path*', destination: `${API_UPSTREAM}/mcp/:path*` },
    ];
  },
};

export default nextConfig;
