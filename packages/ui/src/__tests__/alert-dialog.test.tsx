// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '../components/alert-dialog';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function fixture() {
  const action = vi.fn();
  await act(() =>
    root.render(
      <AlertDialog>
        <AlertDialogTrigger>开始</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>确认操作</AlertDialogTitle>
          <AlertDialogDescription>此操作需要明确确认。</AlertDialogDescription>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={action}>确认</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    ),
  );
  const button = (text: string) => {
    const element = [...document.querySelectorAll('button')].find((el) => el.textContent === text);
    if (!element) throw new Error(`Missing button: ${text}`);
    return element;
  };
  return { action, button, click: (text: string) => act(() => button(text).click()) };
}

it('cancel restores focus and reopening still requires explicit confirmation', async () => {
  const f = await fixture();
  await f.click('开始');
  expect(
    document.querySelector('[role="alertdialog"]')?.closest('[aria-hidden="true"]'),
  ).toBeNull();
  expect(document.activeElement).toBe(f.button('取消'));
  await f.click('取消');
  expect(f.action).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(f.button('开始')));
  await f.click('开始');
  await f.click('确认');
  expect(f.action).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it('clicking the overlay does not authorize or dismiss the confirmation', async () => {
  const f = await fixture();
  await f.click('开始');
  const overlay = document.querySelector<HTMLElement>('[data-slot="alert-dialog-overlay"]');
  if (!overlay) throw new Error('Missing overlay');
  await act(() => overlay.click());
  expect(f.action).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await act(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(f.action).not.toHaveBeenCalled();
});
