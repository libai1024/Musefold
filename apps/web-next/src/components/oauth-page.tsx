'use client';

import { OAuthAuthorizationScreen } from '@musefold/features/account';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

/** Only a provider-validated response reaches this host navigation seam. */
export function navigateOAuth(url: string) {
  const target = new URL(url, window.location.origin);
  const protocol = target.protocol;
  // Registered native callbacks use reverse-domain schemes; never execute data,
  // script, filesystem or browser-internal URLs, even on an invalid API response.
  if (
    protocol !== 'https:' &&
    protocol !== 'http:' &&
    !/^[a-z][a-z0-9+-]*(?:\.[a-z0-9+-]+)+:$/i.test(protocol)
  ) {
    throw new Error('无法打开授权回调');
  }
  window.location.assign(target.href);
}

function OAuthRoute({ screen }: { screen: 'login' | 'consent' }) {
  const query = useSearchParams().toString();
  return <OAuthAuthorizationScreen query={query} screen={screen} onNavigate={navigateOAuth} />;
}

export function OAuthPage({ screen }: { screen: 'login' | 'consent' }) {
  return (
    <Suspense fallback={<p role="status">正在读取授权请求…</p>}>
      <OAuthRoute screen={screen} />
    </Suspense>
  );
}
