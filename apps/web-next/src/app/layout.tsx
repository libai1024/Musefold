import { Toaster } from '@musefold/ui/components/sonner';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '../components/app-shell';
import { Providers } from '../lib/providers';
import './globals.css';

export const metadata: Metadata = {
  title: '未像 Musefold',
  description: 'AI 生图与提示词管理',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * 首帧防闪烁:在 hydration 前按本机偏好挂 dark class 与动效分级标记
 * (与 web-gateway 存储键一致;m 的布尔分支兼容 v2.5 早期布尔存档)。
 */
const THEME_BOOT_SCRIPT = `(function(){try{var e=document.documentElement;var p=JSON.parse(localStorage.getItem('musefold.preferences.v1')||'{}');var t=p.theme||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);e.classList.toggle('dark',d);var m=p.reducedMotion;m=m===true?'on':m===false?'system':(m||'system');e.dataset.motion=m;e.classList.toggle('reduce-motion',m==='on');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 主题防闪烁引导脚本,内容为本地常量 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
