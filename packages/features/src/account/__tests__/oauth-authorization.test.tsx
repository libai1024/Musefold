import type { AccountSummary, CloudMcpOAuthReview, LoginRequest } from '@musefold/contracts';
import {
  type MusefoldGateway,
  PlatformProvider,
  WEB_CAPABILITIES,
  queryKeys,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OAuthAuthorizationScreen } from '../OAuthAuthorizationScreen';

vi.mock('@musefold/ui/components/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const ACCOUNT: AccountSummary = {
  id: 'owner',
  username: 'alice',
  displayName: null,
  quota: 100,
  quotaUnit: '点',
  canGenerate: true,
};
const REVIEW: CloudMcpOAuthReview = {
  client: { id: 'client-a', name: 'My Reader', origin: 'https://reader.example' },
  scopes: ['prompts:read', 'offline_access'],
  account: { id: 'owner', name: 'Alice' },
  loginRequired: false,
  continueUrl: '/api/auth/oauth2/authorize?client_id=client-a',
  reviewRef: 'opaque-review-ref',
};
function setup(
  options: {
    anonymous?: boolean;
    page?: 'login' | 'consent';
    broken?: boolean;
    query?: string;
    forceLogin?: boolean;
    statusGate?: Promise<void>;
  } = {},
) {
  const state = { signedIn: !options.anonymous };
  const review = vi.fn(async () => {
    if (options.broken) throw new Error('read failed');
    return state.signedIn && !options.forceLogin
      ? REVIEW
      : { ...REVIEW, account: null, loginRequired: true, reviewRef: null, continueUrl: null };
  });
  const decide = vi.fn(async () => ({
    redirect: true as const,
    url: 'http://127.0.0.1:54321/callback?code=synthetic',
  }));
  const login = vi.fn(async (_input: LoginRequest) => {
    state.signedIn = true;
    return ACCOUNT;
  });
  const gateway = {
    account: {
      getStatus: async () => {
        await options.statusGate;
        if (!state.signedIn)
          throw Object.assign(new Error('login required'), { code: 'AUTH_REQUIRED' });
        return ACCOUNT;
      },
      login,
      register: login,
    },
    cloudMcp: { authorization: { review, decide } },
  } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const navigate = vi.fn();
  const element = (query = options.query ?? 'signed=synthetic') => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        <OAuthAuthorizationScreen
          screen={options.page ?? 'consent'}
          query={query}
          onNavigate={navigate}
        />
      </PlatformProvider>
    </QueryClientProvider>
  );
  const view = render(element());
  return {
    review,
    decide,
    login,
    navigate,
    client,
    changeQuery: (query: string) => view.rerender(element(query)),
  };
}

describe('OAuth authorization screen', () => {
  it('shows the reviewed client, account, read-only scope and a discoverable denial action', async () => {
    setup();
    expect((await screen.findByTestId('oauth-client-name')).textContent).toBe('My Reader');
    expect(screen.getByText('Alice')).not.toBeNull();
    expect(screen.getByText('读取提示词库')).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '拒绝' }).hasAttribute('disabled')).toBe(false),
    );
    expect(screen.queryByText('读取账号基本信息与额度')).toBeNull();
  });
  it('freezes the explicit decision while pending and does not double-submit', async () => {
    const state = setup();
    let release = () => {};
    state.decide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ redirect: true, url: 'http://127.0.0.1/callback' });
        }),
    );
    const allow = await screen.findByRole('button', { name: '允许只读访问' });
    await waitFor(() => expect(allow.hasAttribute('disabled')).toBe(false));
    fireEvent.click(allow);
    await waitFor(() => expect(allow.hasAttribute('disabled')).toBe(true));
    fireEvent.click(allow);
    expect(screen.getByRole('button', { name: '拒绝' }).hasAttribute('disabled')).toBe(true);
    expect(state.decide).toHaveBeenCalledTimes(1);
    expect(state.decide).toHaveBeenCalledWith({
      oauth_query: 'signed=synthetic',
      reviewRef: REVIEW.reviewRef,
      accept: true,
    });
    await act(async () => release());
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('http://127.0.0.1/callback'));
  });
  it('submits denial rather than navigating to an unvalidated input URL', async () => {
    const state = setup();
    const deny = await screen.findByRole('button', { name: '拒绝' });
    await waitFor(() => expect(deny.hasAttribute('disabled')).toBe(false));
    fireEvent.click(deny);
    await waitFor(() =>
      expect(state.decide).toHaveBeenCalledWith({
        oauth_query: 'signed=synthetic',
        reviewRef: REVIEW.reviewRef,
        accept: false,
      }),
    );
  });
  it('never offers approval for an unreadable or missing request', async () => {
    const state = setup({ broken: true });
    expect((await screen.findByRole('alert')).textContent).toContain('无法核对授权请求');
    expect(screen.queryByRole('button', { name: '允许只读访问' })).toBeNull();
    expect(state.decide).not.toHaveBeenCalled();
  });
  it('does not replay an uncertain decision; explicit recovery only reads the review', async () => {
    const state = setup();
    state.decide.mockRejectedValueOnce(new Error('network result unknown'));
    const allow = await screen.findByRole('button', { name: '允许只读访问' });
    await waitFor(() => expect(allow.hasAttribute('disabled')).toBe(false));
    fireEvent.click(allow);
    expect((await screen.findByRole('alert')).textContent).toContain('未能确认授权结果');
    expect(allow.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重新核对授权请求' }));
    await waitFor(() => expect(allow.hasAttribute('disabled')).toBe(false));
    expect(state.decide).toHaveBeenCalledTimes(1);
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it('reuses ordinary login without changing its payload and continues only to the reviewed URL', async () => {
    const state = setup({ anonymous: true, page: 'login' });
    await screen.findByTestId('account-auth-form');
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } });
    fireEvent.click(screen.getByTestId('account-auth-submit'));
    const button = await screen.findByRole('button', { name: '继续核对授权' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(state.login).toHaveBeenCalledTimes(1);
    expect(state.login.mock.calls[0]?.[0]).not.toHaveProperty('oauth_query');
    expect(state.decide).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(state.navigate).toHaveBeenCalledWith(REVIEW.continueUrl);
  });
});

it('preserves entered reauthentication credentials across late same-account status hydration', async () => {
  let releaseStatus = () => {};
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  const state = setup({ page: 'login', forceLogin: true, statusGate });
  const originalForm = await screen.findByTestId('account-auth-form');
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'typed-owner' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-in-progress' } });
  expect(screen.getByTestId('account-auth-submit').hasAttribute('disabled')).toBe(false);
  await act(async () => releaseStatus());
  await waitFor(() => expect(state.review.mock.calls.length).toBeGreaterThanOrEqual(2));
  await screen.findByTestId('account-auth-form');
  expect((screen.getByLabelText('用户名') as HTMLInputElement).value).toBe('typed-owner');
  expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('synthetic-in-progress');
  expect(screen.getByTestId('account-auth-form')).toBe(originalForm);
  expect(screen.getByTestId('account-auth-submit').hasAttribute('disabled')).toBe(false);
  expect(state.login).not.toHaveBeenCalled();
});

it('discards the login form when the same signed request fails revalidation', async () => {
  const state = setup({ page: 'login', forceLogin: true });
  await screen.findByTestId('account-auth-form');
  await waitFor(() => expect(state.review.mock.calls.length).toBeGreaterThanOrEqual(2));
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-in-progress' } });
  state.review.mockRejectedValueOnce(new Error('request invalidated'));
  act(() =>
    state.client.setQueryData(queryKeys.account.status(), ACCOUNT, {
      updatedAt: (state.client.getQueryState(queryKeys.account.status())?.dataUpdatedAt ?? 0) + 1,
    }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain('无法核对授权请求');
  expect(screen.queryByTestId('account-auth-form')).toBeNull();
  expect(state.login).not.toHaveBeenCalled();
  expect(state.decide).not.toHaveBeenCalled();
});

it('never preserves a previous consent authority during an account recheck', async () => {
  const state = setup();
  await screen.findByRole('button', { name: '允许只读访问' });
  await waitFor(() => expect(state.review.mock.calls.length).toBeGreaterThanOrEqual(2));
  let releaseReview = (_value: CloudMcpOAuthReview) => {};
  state.review.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseReview = resolve;
      }),
  );
  const calls = state.review.mock.calls.length;
  act(() =>
    state.client.setQueryData(queryKeys.account.status(), ACCOUNT, {
      updatedAt: (state.client.getQueryState(queryKeys.account.status())?.dataUpdatedAt ?? 0) + 1,
    }),
  );
  await waitFor(() => expect(state.review.mock.calls.length).toBe(calls + 1));
  expect(screen.queryByRole('button', { name: '允许只读访问' })).toBeNull();
  expect(state.decide).not.toHaveBeenCalled();
  await act(async () => releaseReview(REVIEW));
  await screen.findByRole('button', { name: '允许只读访问' });
});

it('does not carry an entered password into a different signed request', async () => {
  const state = setup({ page: 'login', forceLogin: true });
  await screen.findByTestId('account-auth-form');
  await waitFor(() => expect(state.review.mock.calls.length).toBeGreaterThanOrEqual(2));
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-in-progress' } });
  let releaseReview = (_value: CloudMcpOAuthReview) => {};
  state.review.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseReview = resolve;
      }),
  );
  const calls = state.review.mock.calls.length;
  state.changeQuery('signed=another-request');
  await waitFor(() => expect(state.review.mock.calls.length).toBe(calls + 1));
  expect(screen.queryByTestId('account-auth-form')).toBeNull();
  await act(async () =>
    releaseReview({
      ...REVIEW,
      loginRequired: true,
      account: null,
      reviewRef: null,
      continueUrl: null,
    }),
  );
  await screen.findByTestId('account-auth-form');
  expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('');
  expect(state.login).not.toHaveBeenCalled();
  expect(state.decide).not.toHaveBeenCalled();
});
