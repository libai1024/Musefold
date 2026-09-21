import type { Metadata } from 'next';
import { OAuthPage } from '../../components/oauth-page';

export const metadata: Metadata = {
  title: '登录授权 · 未像',
  robots: 'noindex, nofollow',
  referrer: 'no-referrer',
};
export default function LoginPage() {
  return <OAuthPage screen="login" />;
}
