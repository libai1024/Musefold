import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast, Toaster: () => null };
});

import { toast as sonnerToast } from 'sonner';
import { toast } from '../components/sonner';

const sonnerMock = vi.mocked(sonnerToast);

describe('toast 类型默认值(UI-SPEC §2.4)', () => {
  it('成功提示 2.5s 自动关闭', () => {
    toast.success('已保存');
    expect(sonnerMock.success).toHaveBeenCalledWith('已保存', { duration: 2500 });
  });

  it('错误提示需手动关闭:永不自动消失且带关闭按钮', () => {
    toast.error('保存失败');
    expect(sonnerMock.error).toHaveBeenCalledWith('保存失败', {
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
    });
  });

  it('调用点显式传参优先于类型默认值', () => {
    toast.success('导入完成', { duration: 9000 });
    expect(sonnerMock.success).toHaveBeenCalledWith('导入完成', { duration: 9000 });

    toast.error('导入失败', { closeButton: false });
    expect(sonnerMock.error).toHaveBeenCalledWith('导入失败', {
      duration: Number.POSITIVE_INFINITY,
      closeButton: false,
    });
  });

  it('未覆盖的调用形式原样转发,不改参数', () => {
    toast('普通提示', { duration: 100 });
    expect(sonnerMock).toHaveBeenCalledWith('普通提示', { duration: 100 });

    toast.dismiss('toast-1');
    expect(sonnerMock.dismiss).toHaveBeenCalledWith('toast-1');
  });
});
