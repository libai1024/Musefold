import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  // 自托管 Docker 部署(V25-ARCHITECTURE D8):standalone 输出。
  output: 'standalone',
  transpilePackages: ['@musefold/ui', '@musefold/features', '@musefold/platform'],
  // dev 指示器不入视觉快照(E2E 在 dev 模式跑)。
  devIndicators: false,
  // E2E 经 127.0.0.1 访问 dev server;Next 16 默认只放行 localhost。
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
