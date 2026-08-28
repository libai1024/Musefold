import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node 25 自带残废 localStorage 全局会遮蔽 jsdom 实现;
    // 由 test script 的 NODE_OPTIONS=--no-experimental-webstorage 关闭。
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
});
