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

/** 首帧防闪烁:在 hydration 前按本机偏好挂 dark class(与 web-gateway 的存储键一致)。 */
const THEME_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem('musefold.preferences.v1')||'{}');var t=p.theme||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

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
        </Providers>
      </body>
    </html>
  );
}
