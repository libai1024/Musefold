// v1.4 WEB-01：Web 端 Tailwind 配置——共享主题来自根配置（token 映射的唯一事实源），
// content 只扫本 app，避免把 web-only 类打进桌面产物（反之亦然）。
import type { Config } from 'tailwindcss';
import base from '../../tailwind.config';

export default {
  ...base,
  content: ['./src/**/*.{ts,tsx,html}'],
} satisfies Config;
