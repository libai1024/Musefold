import type { Metadata } from 'next';
import { OAuthPage } from '../../components/oauth-page';

export const metadata: Metadata = {
  title: '应用授权 · 未像',
  robots: 'noindex, nofollow',
  referrer: 'no-referrer',
};
export default function ConsentPage() {
  return <OAuthPage screen="consent" />;
}
