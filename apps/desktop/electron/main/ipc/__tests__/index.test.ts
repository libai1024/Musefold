import { beforeEach, describe, expect, it, vi } from 'vitest';

const registrations = vi.hoisted(() => ({
  updater: vi.fn(),
  pet: vi.fn(),
  doubaoLoginSync: vi.fn(),
}));

vi.mock('../updater', () => ({ registerUpdaterHandlers: registrations.updater }));
vi.mock('../../pet', () => ({ registerPetHandlers: registrations.pet }));
vi.mock('../../doubao-login-sync', () => ({
  startDoubaoLoginSync: registrations.doubaoLoginSync,
}));

import { registerAllHandlers } from '../index';

describe('main IPC registry(v2.5 收口后)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('只装配 updater、pet 与 doubao 登录同步;数据域走 v25 单通道桥', () => {
    registerAllHandlers();

    expect(registrations.updater).toHaveBeenCalledTimes(1);
    expect(registrations.pet).toHaveBeenCalledTimes(1);
    expect(registrations.doubaoLoginSync).toHaveBeenCalledTimes(1);
  });
});
