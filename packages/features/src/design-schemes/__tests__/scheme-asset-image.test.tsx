import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { designSchemeAssetSchema } from '@musefold/contracts';
import { SchemeAssetImage } from '../SchemeAssetImage';
import { SchemeAlbum } from '../SchemeAlbum';

afterEach(cleanup);
const asset = designSchemeAssetSchema.parse({
  id: 'image-a',
  origin: 'cloud-run',
  role: 'example',
  mimeType: 'image/png',
  width: 2,
  height: 3,
  byteSize: 100,
  contentHash: 'a'.repeat(64),
  license: null,
  createdAt: 0,
});
describe('scheme image load and recovery', () => {
  it('removing the displayed asset closes its lightbox and restoring metadata does not reopen it', async () => {
    const props = {
      coverAssetId: null,
      resolveAssetUrl: () => '/image-a',
      onSetCover: vi.fn(),
      coverBusy: false,
    };
    const { rerender } = render(<SchemeAlbum assets={[asset]} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '全屏查看当前示例' }));
    expect(screen.getByTestId('scheme-asset-lightbox')).toBeTruthy();
    rerender(<SchemeAlbum assets={[]} {...props} />);
    expect(screen.getByText('还没有试运行结果')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('scheme-asset-lightbox')).toBeNull());
    rerender(<SchemeAlbum assets={[asset]} {...props} />);
    expect(screen.queryByTestId('scheme-asset-lightbox')).toBeNull();
  });
  it('starts unloaded, exposes its preview action and becomes loaded on image completion', () => {
    const open = vi.fn();
    render(<SchemeAssetImage src="/image-a" alt="方案示例" onOpen={open} />);
    const img = screen.getByRole('img', { name: '方案示例' });
    expect(img.getAttribute('data-loaded')).toBe('false');
    fireEvent.load(img);
    expect(img.getAttribute('data-loaded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '全屏查看当前示例' }));
    expect(open).toHaveBeenCalledOnce();
  });
  it('failed image has explicit retry, no nested buttons or inaccessible preview action', () => {
    const open = vi.fn();
    const { container } = render(<SchemeAssetImage src="/image-a" alt="方案示例" onOpen={open} />);
    fireEvent.error(screen.getByRole('img', { name: '方案示例' }));
    expect(screen.getByText('图片暂时无法显示')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '全屏查看当前示例' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新加载图片' }));
    expect(screen.getByRole('img', { name: '方案示例' }).getAttribute('src')).toBe('/image-a');
    expect(open).not.toHaveBeenCalled();
    expect(container.querySelector('button button')).toBeNull();
  });
  it('a different asset drops previous errors and completed-load state; late old events are ignored', () => {
    const { rerender } = render(<SchemeAssetImage src="/image-a" alt="方案示例" />);
    const old = screen.getByRole('img', { name: '方案示例' });
    fireEvent.load(old);
    rerender(<SchemeAssetImage src="/image-b" alt="方案示例" />);
    const next = screen.getByRole('img', { name: '方案示例' });
    expect(next.getAttribute('data-loaded')).toBe('false');
    fireEvent.error(old);
    expect(screen.queryByText('图片暂时无法显示')).toBeNull();
    fireEvent.error(next);
    rerender(<SchemeAssetImage src="/image-c" alt="方案示例" />);
    expect(screen.queryByText('图片暂时无法显示')).toBeNull();
    expect(screen.getByRole('img', { name: '方案示例' }).getAttribute('src')).toBe('/image-c');
  });
  it('compact thumbnails preserve the containing row action without adding a nested retry', () => {
    const { container } = render(
      <button type="button">
        <SchemeAssetImage compact src="/image-a" alt="" />
      </button>,
    );
    const img = container.querySelector('img');
    if (!img) throw new Error('Missing thumbnail');
    fireEvent.error(img);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByText('图片暂时无法显示')).toBeTruthy();
  });
});
