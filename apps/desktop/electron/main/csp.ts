/** 构造由主进程注入的 CSP。生产环境不允许 renderer 出网，Provider 请求只走 IPC/main。 */
export function buildContentSecurityPolicy(rendererUrl?: string): string {
  const directives = rendererUrl ? developmentDirectives(rendererUrl) : productionDirectives();
  return directives.join('; ');
}

function commonDirectives(): string[] {
  return [
    "default-src 'self'",
    "img-src 'self' media: data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ];
}

function productionDirectives(): string[] {
  return [
    ...commonDirectives(),
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
  ];
}

function developmentDirectives(rendererUrl: string): string[] {
  const origin = new URL(rendererUrl).origin;
  const websocketOrigin = origin.replace(/^http/, 'ws');
  return [
    ...commonDirectives(),
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${origin}`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `connect-src 'self' ${origin} ${websocketOrigin} ws://localhost:* http://localhost:*`,
  ];
}
