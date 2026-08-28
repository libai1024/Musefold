import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // globals 供 @testing-library/react 注册自动 cleanup(依赖全局 afterEach)。
    globals: true,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
});
