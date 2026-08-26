import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WebGatewayError } from '../../runtime';
import {
  accountAccessErrorMessage,
  LoginScreen,
  submitAccountAccess,
  validateAccountForm,
} from '../BootScreens';

const validDraft = {
  username: 'musefold',
  password: 'secret',
  passwordConfirmation: 'secret',
};

describe('LoginScreen', () => {
  it('renders accessible login and registration modes with correct autocomplete values', () => {
    const gateway = { login: vi.fn(), register: vi.fn() };
    const login = renderToStaticMarkup(
      <LoginScreen gateway={gateway} onAuthenticated={() => undefined} />,
    );
    const register = renderToStaticMarkup(
      <LoginScreen gateway={gateway} onAuthenticated={() => undefined} initialMode="register" />,
    );

    expect(login).toContain('role="tablist"');
    expect(login).toContain('aria-selected="true"');
    expect(login).toContain('autoComplete="username"');
    expect(login).toContain('autoComplete="current-password"');
    expect(login).not.toContain('name="passwordConfirmation"');
    expect(register.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(register).toContain('name="passwordConfirmation"');
    expect(register).toContain('注册个人账户');
  });
});

describe('account form validation', () => {
  it('requires account credentials and matching registration passwords', () => {
    expect(
      validateAccountForm('register', {
        username: ' ',
        password: '',
        passwordConfirmation: '',
      }),
    ).toEqual({
      username: '请输入账号',
      password: '请输入密码',
      passwordConfirmation: '请再次输入密码',
    });
    expect(
      validateAccountForm('register', {
        ...validDraft,
        passwordConfirmation: 'different',
      }),
    ).toEqual({ passwordConfirmation: '两次输入的密码不一致' });
    expect(validateAccountForm('login', validDraft)).toEqual({});
  });
});

describe('account access errors', () => {
  it('maps gateway codes to actionable copy without exposing transport messages', () => {
    const cause = new WebGatewayError(
      'AUTH_CREDENTIALS_INVALID',
      'upstream secret diagnostics: account 42',
    );

    const message = accountAccessErrorMessage(cause, 'login');
    expect(message).toBe('账号或密码不正确，请检查后重试');
    expect(message).not.toContain(cause.message);
    expect(
      accountAccessErrorMessage(new WebGatewayError('RATE_LIMITED', 'retry after 10'), 'register'),
    ).toBe('操作过于频繁，请稍后再试');
    expect(accountAccessErrorMessage(new Error('database credentials'), 'register')).toBe(
      '暂时无法注册，请稍后重试',
    );
  });
});

describe('submitAccountAccess', () => {
  it.each(['login', 'register'] as const)(
    'uses %s and preserves a safe OAuth returnTo',
    async (mode) => {
      const gateway = {
        login: vi.fn().mockResolvedValue(undefined),
        register: vi.fn().mockResolvedValue(undefined),
      };
      const navigate = vi.fn();
      const onAuthenticated = vi.fn();

      await submitAccountAccess({
        gateway,
        mode,
        username: ' musefold ',
        password: 'secret',
        returnTo: 'https://musefold.example/api/musefold/v1/oauth/interaction/abc?client=mcp',
        currentOrigin: 'https://musefold.example',
        navigate,
        onAuthenticated,
      });

      expect(gateway[mode]).toHaveBeenCalledWith({ username: 'musefold', password: 'secret' });
      expect(navigate).toHaveBeenCalledWith('/api/musefold/v1/oauth/interaction/abc?client=mcp');
      expect(onAuthenticated).not.toHaveBeenCalled();
    },
  );

  it('rejects unsafe returnTo values after registration and enters the workspace', async () => {
    const gateway = {
      login: vi.fn(),
      register: vi.fn().mockResolvedValue(undefined),
    };
    const navigate = vi.fn();
    const onAuthenticated = vi.fn();

    await submitAccountAccess({
      gateway,
      mode: 'register',
      username: 'musefold',
      password: 'secret',
      returnTo: 'https://attacker.example/steal',
      currentOrigin: 'https://musefold.example',
      navigate,
      onAuthenticated,
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });
});
