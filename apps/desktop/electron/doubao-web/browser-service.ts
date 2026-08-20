import { BrowserWindow, session, type Session } from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { ulid } from 'ulid';
import type {
  DoubaoWebAccountStatus,
  GenerateImageRequest,
  GenerateImageResult,
  ValidationResult,
} from '@musefold/desktop-contracts/providers';
import { getPaths } from '../system/paths';
import { createLogger } from '../system/logger';
import { getDoubaoWebUsage, reserveDoubaoWebGeneration } from './usage-limit';
import { decodeDownloadedImage, decodeImageDataUrl } from './image-data';
import { readLocalImage } from '@musefold/core/providers/local-image';
import {
  DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE,
  DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE,
  DOUBAO_USER_MESSAGE_ALIGNMENT_CLASS,
} from './dom-image-filter';
import { pickDoubaoAccount, type DoubaoAccountNameCandidate } from './account-name';
import { composeDoubaoWebPrompt } from './prompt';

export const DOUBAO_IMAGE_URL = 'https://www.doubao.com/chat/create-image';
const DOUBAO_SESSION_PARTITION = 'persist:musefold-doubao-web-v1';
const PAGE_READY_TIMEOUT_MS = 25_000;
const GENERATION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 900;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const EXPECTED_IMAGE_COUNT = 4;
const PARTIAL_RESULT_STABLE_MS = 6_000;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const LOGIN_QR_WAIT_TIMEOUT_MS = 12_000;
const LOGIN_QR_POLL_INTERVAL_MS = 350;
const EDITOR_RECOVERY_TIMEOUT_MS = 15_000;

const logger = createLogger('provider:doubao-web');
type DoubaoLoginListener = (status: DoubaoWebAccountStatus) => void;

interface PageState {
  editorReady: boolean;
  loginRequired: boolean;
  verificationRequired: boolean;
  accountName: string | null;
  avatarUrl: string | null;
}

interface PageImage {
  src: string;
  width: number;
  height: number;
}

interface PageReplyCandidate {
  images: PageImage[];
  message: string;
  completed: boolean;
}

interface LoginQrSnapshot {
  dataUrl: string | null;
  expired: boolean;
  present: boolean;
}

let browserWindow: BrowserWindow | null = null;
let partitionConfigured = false;
let operationQueue: Promise<void> = Promise.resolve();
let cachedAvatar: { url: string; dataUrl: string } | null = null;
let developerWindowVisible = false;
let loginPoller: ReturnType<typeof setInterval> | null = null;
let loginState: DoubaoWebAccountStatus['loginState'] = 'logged-out';
let loginQrCodeDataUrl: string | null = null;
let loginQrExpiresAt: number | null = null;
let loginErrorMessage: string | null = null;
const loginListeners = new Set<DoubaoLoginListener>();

function codedError(code: string, message: string): Error {
  const error = new Error(message);
  (error as { code?: string }).code = code;
  return error;
}

function abortError(): Error {
  return codedError('CANCELLED', '已取消生成');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function configurePartition(ses: Session): void {
  if (partitionConfigured) return;
  partitionConfigured = true;
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

function getOrCreateWindow(show = false): BrowserWindow {
  if (browserWindow && !browserWindow.isDestroyed()) {
    if (show) {
      browserWindow.show();
      browserWindow.focus();
    }
    return browserWindow;
  }

  const ses = session.fromPartition(DOUBAO_SESSION_PARTITION);
  configurePartition(ses);
  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    show: show && developerWindowVisible,
    title: '豆包网页版连接',
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: DOUBAO_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // 这是没有 preload/Node 权限的隔离窗口；登录会话只留在专用持久 partition 内。
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).protocol === 'https:') return;
    } catch {
      // Invalid navigation targets are denied below.
    }
    event.preventDefault();
  });
  win.on('closed', () => {
    if (browserWindow === win) browserWindow = null;
  });
  browserWindow = win;
  return win;
}

async function ensureImagePage(show = false): Promise<BrowserWindow> {
  const win = getOrCreateWindow(show);
  if (!developerWindowVisible && win.isVisible()) win.hide();
  const currentUrl = win.webContents.getURL();
  if (!currentUrl.startsWith(DOUBAO_IMAGE_URL)) {
    try {
      await win.loadURL(DOUBAO_IMAGE_URL);
    } catch (error) {
      throw codedError(
        'NETWORK',
        `豆包网页加载失败：${error instanceof Error ? error.message : '网络不可用'}`,
      );
    }
  }
  return win;
}

async function inspectPage(win: BrowserWindow): Promise<PageState> {
  if (win.isDestroyed()) throw codedError('WEB_WINDOW_CLOSED', '豆包窗口已关闭');
  const state = await win.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const editor = Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .filter(visible)
      .sort((left, right) => {
        const score = (element) => {
          const hint = [
            element.getAttribute('role') || '',
            element.getAttribute('aria-label') || '',
            element.getAttribute('data-placeholder') || '',
            element.getAttribute('placeholder') || '',
            element.textContent || '',
          ].join(' ');
          return (element.getAttribute('role') === 'textbox' ? 4 : 0)
            + (/描述|消息|图片|prompt/i.test(hint) ? 3 : 0)
            + (element.getBoundingClientRect().top > window.innerHeight * 0.45 ? 1 : 0);
        };
        return score(right) - score(left);
      })[0] || null;
    const loginRequired = Array.from(document.querySelectorAll('button, [role="button"]'))
      .some((element) => visible(element) && (element.textContent || '').trim() === '登录');
    const text = (document.body?.innerText || '').slice(-6000);
    const accountCandidates = Array.from(document.querySelectorAll(
      'button, a[href], [role="button"], [data-testid*="user" i], [class*="avatar" i]'
    )).flatMap((element) => {
      if (!(element instanceof HTMLElement) || !visible(element)) return [];
      const rect = element.getBoundingClientRect();
      const avatar = element.querySelector('img');
      return [{
        text: element.innerText || element.textContent || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        title: element.getAttribute('title') || '',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        tagName: element.tagName,
        avatarUrl: avatar instanceof HTMLImageElement ? (avatar.currentSrc || avatar.src) : '',
        hasAvatar: Boolean(element.querySelector('img, [class*="avatar" i]')),
        interactive: element.matches('button, a[href], [role="button"]'),
        conversationItem: Boolean(element.closest('[class*="conversation-item" i]')),
      }];
    });
    return {
      editorReady: Boolean(editor && visible(editor)),
      loginRequired,
      verificationRequired: /验证码|安全验证|完成验证|异常访问|访问过于频繁/.test(text),
      accountCandidates,
    };
  })()`, true) as {
    editorReady: boolean;
    loginRequired: boolean;
    verificationRequired: boolean;
    accountCandidates: DoubaoAccountNameCandidate[];
  };
  const account = pickDoubaoAccount(state.accountCandidates);
  return {
    editorReady: state.editorReady,
    loginRequired: state.loginRequired,
    verificationRequired: state.verificationRequired,
    accountName: account?.accountName ?? null,
    avatarUrl: account?.avatarUrl ?? null,
  };
}

async function waitForPageState(win: BrowserWindow, signal?: AbortSignal): Promise<PageState> {
  const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
  let state: PageState = {
    editorReady: false,
    loginRequired: false,
    verificationRequired: false,
    accountName: null,
    avatarUrl: null,
  };
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    state = await inspectPage(win);
    if (state.editorReady || state.loginRequired || state.verificationRequired) return state;
    await delay(POLL_INTERVAL_MS, signal);
  }
  return state;
}

function revealWindow(win: BrowserWindow): void {
  if (win.isDestroyed() || !developerWindowVisible) return;
  win.show();
  win.focus();
}

function stopLoginPoller(): void {
  if (loginPoller) clearInterval(loginPoller);
  loginPoller = null;
}

function emitLoginStatus(status: DoubaoWebAccountStatus): void {
  for (const listener of loginListeners) listener(status);
}

function withLoginFlow(status: DoubaoWebAccountStatus): DoubaoWebAccountStatus {
  return {
    ...status,
    loginState,
    qrCodeDataUrl: loginQrCodeDataUrl,
    qrExpiresAt: loginQrExpiresAt,
    errorMessage: loginErrorMessage,
  };
}

async function clickLoginIfNeeded(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    if (Array.from(document.querySelectorAll('[class*="qrcode-"]')).some(visible)) return false;
    const button = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .find((element) => visible(element) && /^(登录|扫码登录)$/.test((element.textContent || '').trim()));
    if (button instanceof HTMLElement) { button.click(); return true; }
    return false;
  })()`, true);
}

async function clickLoginQrRefreshIfNeeded(win: BrowserWindow): Promise<boolean> {
  return win.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const qrContainer = Array.from(document.querySelectorAll('[class*="qrcode-"]')).find(visible);
    if (!(qrContainer instanceof HTMLElement)) return false;
    let scope = qrContainer.parentElement;
    for (let depth = 0; scope && depth < 3; depth += 1) {
      const refreshTarget = Array.from(scope.querySelectorAll('button, [role="button"], a, div, span'))
        .filter((element) => visible(element) && /二维码失效|点击刷新|刷新二维码|重新获取/.test((element.textContent || '').trim()))
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
        })[0];
      if (refreshTarget instanceof HTMLElement) {
        refreshTarget.click();
        return true;
      }
      scope = scope.parentElement;
    }
    return false;
  })()`, true) as Promise<boolean>;
}

async function waitForLoginQrCode(win: BrowserWindow): Promise<string | null> {
  const deadline = Date.now() + LOGIN_QR_WAIT_TIMEOUT_MS;
  let refreshed = false;
  while (Date.now() < deadline) {
    const snapshot = await readLoginQrSnapshot(win);
    if (snapshot.dataUrl) return snapshot.dataUrl;
    if (snapshot.expired && !refreshed) {
      refreshed = await clickLoginQrRefreshIfNeeded(win);
      if (refreshed) {
        await delay(500);
        continue;
      }
    }
    await delay(LOGIN_QR_POLL_INTERVAL_MS);
  }
  return null;
}

async function readLoginQrSnapshot(win: BrowserWindow): Promise<LoginQrSnapshot> {
  const raw = await win.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const qrContainer = Array.from(document.querySelectorAll('[class*="qrcode-"]')).find(visible);
    if (!(qrContainer instanceof HTMLElement)) return { markup: null, expired: false, present: false };

    let loginScope = qrContainer.parentElement;
    for (let depth = 0; loginScope && depth < 8; depth += 1) {
      const scopeText = loginScope.innerText || '';
      if (/登录以解锁更多功能/.test(scopeText) && /豆包.*飞书 App|点击扫一扫/.test(scopeText)) break;
      loginScope = loginScope.parentElement;
    }
    if (!loginScope) return { markup: null, expired: false, present: false };

    const expired = Array.from(loginScope.querySelectorAll('button, [role="button"], a, div, span'))
      .some((element) => visible(element) && /二维码失效|点击刷新/.test((element.textContent || '').trim()));
    if (expired) return { markup: null, expired: true, present: true };

    const svg = qrContainer.querySelector('svg');
    if (!(svg instanceof SVGSVGElement) || !visible(svg)) {
      return { markup: null, expired: false, present: true };
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120 || Math.abs(rect.width - rect.height) > 32) {
      return { markup: null, expired: false, present: true };
    }

    const clone = svg.cloneNode(true);
    const allowedTags = new Set([
      'svg', 'g', 'defs', 'clippath', 'rect', 'circle', 'path', 'polygon', 'polyline', 'line', 'ellipse',
    ]);
    Array.from(clone.querySelectorAll('*')).forEach((element) => {
      if (!allowedTags.has(element.tagName.toLowerCase())) {
        element.remove();
        return;
      }
      Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && !value.startsWith('#'))) {
          element.removeAttribute(attribute.name);
        }
      });
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return {
      markup: new XMLSerializer().serializeToString(clone),
      expired: false,
      present: true,
    };
  })()`, true) as { markup: string | null; expired: boolean; present: boolean } | null;
  const snapshot = raw;
  if (!snapshot?.markup) {
    return {
      dataUrl: null,
      expired: snapshot?.expired ?? false,
      present: snapshot?.present ?? false,
    };
  }
  const bytes = Buffer.from(snapshot.markup, 'utf8');
  if (bytes.length > 2 * 1024 * 1024) {
    return { dataUrl: null, expired: false, present: true };
  }
  return {
    dataUrl: `data:image/svg+xml;base64,${bytes.toString('base64')}`,
    expired: false,
    present: true,
  };
}

async function readAccountStatusSnapshot(): Promise<DoubaoWebAccountStatus> {
  try {
    const win = await ensureImagePage(false);
    const state = await waitForPageState(win);
    const loggedIn = state.editorReady && !state.loginRequired && !state.verificationRequired;
    if (loggedIn) {
      loginState = 'logged-in';
      loginQrCodeDataUrl = null;
      loginQrExpiresAt = null;
    } else if (state.verificationRequired) {
      loginState = 'verification-required';
    }
    const usage = getDoubaoWebUsage(undefined, new Date(), state.accountName);
    const avatarDataUrl = await readAccountAvatar(win, state.avatarUrl);
    return withLoginFlow({
      loggedIn,
      accountName: state.accountName,
      avatarDataUrl,
      verificationRequired: state.verificationRequired,
      usage,
    });
  } catch {
    return withLoginFlow({
      loggedIn: false,
      accountName: null,
      avatarDataUrl: null,
      verificationRequired: false,
      usage: getDoubaoWebUsage(),
    });
  }
}

async function publishLoginSnapshot(): Promise<DoubaoWebAccountStatus> {
  const status = await readAccountStatusSnapshot();
  const snapshot = withLoginFlow(status);
  emitLoginStatus(snapshot);
  return snapshot;
}

function startLoginPoller(): void {
  stopLoginPoller();
  loginPoller = setInterval(() => {
    void serialized(async () => {
      if (!browserWindow || browserWindow.isDestroyed()) return;
      const state = await inspectPage(browserWindow);
      if (state.editorReady && !state.loginRequired && !state.verificationRequired) {
        loginState = 'logged-in';
        loginQrCodeDataUrl = null;
        loginQrExpiresAt = null;
        loginErrorMessage = null;
        stopLoginPoller();
        await publishLoginSnapshot();
        return;
      }
      const qrSnapshot = loginState === 'qr-ready'
        ? await readLoginQrSnapshot(browserWindow)
        : { dataUrl: loginQrCodeDataUrl, expired: false, present: Boolean(loginQrCodeDataUrl) };
      if (loginState === 'qr-ready' && qrSnapshot.expired) {
        loginState = 'loading';
        loginQrCodeDataUrl = null;
        loginQrExpiresAt = null;
        loginErrorMessage = null;
        await publishLoginSnapshot();

        loginQrCodeDataUrl = await waitForLoginQrCode(browserWindow);
        loginQrExpiresAt = loginQrCodeDataUrl ? Date.now() + 120_000 : null;
        loginState = loginQrCodeDataUrl ? 'qr-ready' : 'error';
        loginErrorMessage = loginQrCodeDataUrl
          ? null
          : '豆包二维码已失效，自动刷新失败，请点击“刷新二维码”重试。';
        await publishLoginSnapshot();
        return;
      }
      const currentQr = qrSnapshot.dataUrl;
      if (currentQr && currentQr !== loginQrCodeDataUrl) loginQrCodeDataUrl = currentQr;
      if (loginState === 'qr-ready' && !currentQr && !state.loginRequired) {
        loginState = 'scanned';
        await publishLoginSnapshot();
        return;
      }
      if (state.verificationRequired) {
        loginState = 'verification-required';
        await publishLoginSnapshot();
      } else if (loginQrExpiresAt && Date.now() > loginQrExpiresAt) {
        // 豆包实际失效状态以网页覆盖层为准；本地时间仅用于让 UI 周期性复核。
        loginQrExpiresAt = Date.now() + 15_000;
      }
    }).catch((error) => {
      loginState = 'error';
      loginErrorMessage = error instanceof Error ? error.message : '豆包登录状态读取失败';
      void publishLoginSnapshot().catch(() => {});
    });
  }, POLL_INTERVAL_MS);
}

async function requireAuthenticatedPage(signal?: AbortSignal): Promise<BrowserWindow> {
  const win = await ensureImagePage(false);
  let state = await waitForPageState(win, signal);
  if (state.verificationRequired) {
    revealWindow(win);
    throw codedError('WEB_VERIFICATION_REQUIRED', '豆包要求人工验证，请在已打开的窗口中完成后重试');
  }
  if (state.loginRequired) {
    revealWindow(win);
    throw codedError('AUTH', '请先在已打开的豆包窗口中完成登录，然后重试');
  }
  if (!state.editorReady) {
    const previousUrl = win.webContents.getURL();
    logger.warn('未找到豆包生图输入框，尝试重开生图页', `url=${previousUrl || '(empty)'}`);
    try {
      await win.loadURL(DOUBAO_IMAGE_URL);
      const recoveryDeadline = Date.now() + EDITOR_RECOVERY_TIMEOUT_MS;
      do {
        throwIfAborted(signal);
        state = await inspectPage(win);
        if (state.editorReady || state.loginRequired || state.verificationRequired) break;
        await delay(POLL_INTERVAL_MS, signal);
      } while (Date.now() < recoveryDeadline);
    } catch (error) {
      if ((error as { code?: string }).code === 'CANCELLED') throw error;
      logger.warn('重开豆包生图页失败', error instanceof Error ? error.message : String(error));
    }
    if (state.verificationRequired) {
      revealWindow(win);
      throw codedError('WEB_VERIFICATION_REQUIRED', '豆包要求人工验证，请在已打开的窗口中完成后重试');
    }
    if (state.loginRequired) {
      revealWindow(win);
      throw codedError('AUTH', '豆包登录已失效，请重新登录后重试');
    }
    if (!state.editorReady) {
      revealWindow(win);
      throw codedError('WEB_PAGE_CHANGED', '重开豆包生图页后仍未找到输入框，网页可能已改版');
    }
  }
  return win;
}

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = operationQueue.catch(() => undefined).then(task);
  operationQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function openDoubaoWebLogin(): Promise<{ opened: true }> {
  await startDoubaoWebLogin();
  return { opened: true };
}

export async function setDoubaoDeveloperWindowVisible(visible: boolean): Promise<void> {
  developerWindowVisible = visible;
  if (!visible) {
    if (browserWindow && !browserWindow.isDestroyed() && browserWindow.isVisible()) browserWindow.hide();
    return;
  }
  const win = await ensureImagePage(true);
  revealWindow(win);
}

export function subscribeDoubaoWebLogin(listener: DoubaoLoginListener): () => void {
  loginListeners.add(listener);
  return () => loginListeners.delete(listener);
}

export async function startDoubaoWebLogin(): Promise<DoubaoWebAccountStatus> {
  return serialized(async () => {
    const win = await ensureImagePage(false);
    loginState = 'loading';
    loginErrorMessage = null;
    loginQrCodeDataUrl = null;
    loginQrExpiresAt = null;
    await clickLoginIfNeeded(win);
    loginQrCodeDataUrl = await waitForLoginQrCode(win);
    loginQrExpiresAt = loginQrCodeDataUrl ? Date.now() + 120_000 : null;
    loginState = loginQrCodeDataUrl ? 'qr-ready' : 'error';
    loginErrorMessage = loginQrCodeDataUrl
      ? null
      : '没有找到豆包二维码。页面可能还在加载，请刷新二维码重试。';
    const snapshot = await publishLoginSnapshot();
    startLoginPoller();
    if (developerWindowVisible) revealWindow(win);
    return snapshot;
  });
}

export async function refreshDoubaoWebLogin(): Promise<DoubaoWebAccountStatus> {
  stopLoginPoller();
  return startDoubaoWebLogin();
}

export async function logoutDoubaoWeb(): Promise<DoubaoWebAccountStatus> {
  return serialized(async () => {
    stopLoginPoller();
    const ses = session.fromPartition(DOUBAO_SESSION_PARTITION);
    await ses.clearStorageData();
    if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.session.clearStorageData().catch(() => {});
    cachedAvatar = null;
    loginState = 'logged-out';
    loginQrCodeDataUrl = null;
    loginQrExpiresAt = null;
    loginErrorMessage = null;
    if (browserWindow && !browserWindow.isDestroyed()) {
      await browserWindow.loadURL(DOUBAO_IMAGE_URL).catch(() => {});
      browserWindow.hide();
    }
    return publishLoginSnapshot();
  });
}

export function validateDoubaoWebSession(): Promise<ValidationResult> {
  return serialized(async () => {
    try {
      const win = await requireAuthenticatedPage();
      const state = await inspectPage(win);
      const usage = getDoubaoWebUsage(undefined, new Date(), state.accountName);
      if (win.isVisible()) win.hide();
      return {
        ok: true,
        message: `豆包网页已登录，今日剩余 ${usage.remaining}/${usage.limit} 次`,
        models: [{ id: 'seedream-4.5', name: 'Seedream 4.5' }],
      };
    } catch (error) {
      return {
        ok: false,
        code: (error as { code?: string }).code ?? 'UNKNOWN',
        message: error instanceof Error ? error.message : '豆包网页连接失败',
      };
    }
  });
}

async function readAccountAvatar(win: BrowserWindow, url: string | null): Promise<string | null> {
  if (!url) return null;
  if (cachedAvatar?.url === url) return cachedAvatar.dataUrl;
  try {
    const response = await win.webContents.session.fetch(url, {
      headers: { Referer: 'https://www.doubao.com/' },
    });
    if (!response.ok) return null;
    const mime = (response.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase();
    if (!mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return null;
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
    cachedAvatar = { url, dataUrl };
    return dataUrl;
  } catch {
    return null;
  }
}

/** 读取账号摘要时不主动弹出登录窗口，供侧栏常驻状态使用。 */
export function getDoubaoWebAccountStatus(): Promise<DoubaoWebAccountStatus> {
  return serialized(readAccountStatusSnapshot);
}

async function listPageImages(win: BrowserWindow): Promise<PageImage[]> {
  return win.webContents.executeJavaScript(`(() => {
    return Array.from(document.images).flatMap((image) => {
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      const src = image.currentSrc || image.src;
      if (!src || src.toLowerCase().startsWith('data:image/svg+xml')) return [];
      if (
        image.naturalWidth < ${DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE}
        || image.naturalHeight < ${DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE}
      ) return [];
      if (
        rect.width < ${DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE}
        || rect.height < ${DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE}
        || style.display === 'none'
        || style.visibility === 'hidden'
      ) return [];
      return [{ src, width: image.naturalWidth, height: image.naturalHeight }];
    });
  })()`, true) as Promise<PageImage[]>;
}

async function inspectGeneratedReply(
  win: BrowserWindow,
  baseline: Set<string>,
  submittedPrompt: string,
): Promise<PageReplyCandidate> {
  return win.webContents.executeJavaScript(`(() => {
    const baseline = new Set(${JSON.stringify([...baseline])});
    const submittedPrompt = ${JSON.stringify(submittedPrompt)}.trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width >= ${DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE}
        && rect.height >= ${DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE}
        && style.display !== 'none'
        && style.visibility !== 'hidden'
      );
    };
    const belongsToUserMessage = (image) => {
      let container = image.parentElement;
      for (let depth = 0; container && depth < 16; depth += 1, container = container.parentElement) {
        const classes = typeof container.className === 'string' ? container.className.split(/\\s+/) : [];
        if (classes.includes('${DOUBAO_USER_MESSAGE_ALIGNMENT_CLASS}')) return true;
      }
      return false;
    };
    const imageEntries = Array.from(document.images).flatMap((image) => {
      const src = image.currentSrc || image.src;
      if (!src || baseline.has(src) || src.toLowerCase().startsWith('data:image/svg+xml')) return [];
      if (
        image.naturalWidth < ${DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE}
        || image.naturalHeight < ${DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE}
        || !visible(image)
        || belongsToUserMessage(image)
      ) return [];
      return [{ element: image, src, width: image.naturalWidth, height: image.naturalHeight }];
    });
    const pageText = (document.body?.innerText || '').slice(-12_000);
    const pageCompleted = /已完成(?:图片)?生成|生成了?\\s*[1-4四]\\s*张|按.+生成/.test(pageText);
    // 带参考图生成完成后，豆包会自动打开查看器。此时主结果绘制在 canvas，
    // 对应的 img 只剩 56-120px 缩略图，达不到普通结果图的展示尺寸阈值。
    const canvasEntries = pageCompleted ? Array.from(document.querySelectorAll('canvas')).flatMap((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      if (
        canvas.width < ${DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE}
        || canvas.height < ${DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE}
        || rect.width < ${DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE}
        || rect.height < ${DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE}
        || style.display === 'none'
        || style.visibility === 'hidden'
      ) return [];
      try {
        const src = canvas.toDataURL('image/png');
        if (!src || src === 'data:,') return [];
        return [{ element: canvas, src, width: canvas.width, height: canvas.height }];
      } catch {
        return [];
      }
    }) : [];
    const entries = [...imageEntries, ...canvasEntries];
    if (entries.length === 0) return { images: [], message: '', completed: false };

    // 豆包会把一轮的 4 张图放在同一个回复容器内。寻找包含最多新图的最小祖先，
    // 可以排除侧栏缩略图和旧回复因懒加载产生的干扰。
    let best = null;
    for (const entry of entries) {
      let container = entry.element.parentElement;
      for (let depth = 0; container && depth < 9; depth += 1, container = container.parentElement) {
        const contained = entries.filter((candidate) => container.contains(candidate.element));
        const count = Math.min(contained.length, ${EXPECTED_IMAGE_COUNT});
        if (!best || count > best.count || (count === best.count && depth < best.depth)) {
          best = { container, entries: contained, count, depth };
        }
        if (count >= ${EXPECTED_IMAGE_COUNT}) break;
      }
    }
    const selectedEntries = (best?.entries ?? entries).slice(-${EXPECTED_IMAGE_COUNT});
    let textContainer = best?.container ?? selectedEntries[0]?.element?.parentElement ?? null;
    let containerText = '';
    for (let depth = 0; textContainer && depth < 16; depth += 1, textContainer = textContainer.parentElement) {
      const text = (textContainer.innerText || textContainer.textContent || '').trim();
      if (!text) continue;
      containerText = text;
      if (/已完成(?:图片)?生成|生成了?\\s*[1-4四]\\s*张|按.+生成/.test(text)) break;
    }
    const noise = new Set([
      submittedPrompt,
      'AI 生成可能有误 注意核实',
      'AI 生成可能有误，请注意核实',
      '已完成图片生成',
    ]);
    const message = containerText
      .split('\\n')
      .map((line) => line.trim())
      .filter((line) => line && !noise.has(line) && !submittedPrompt.includes(line))
      .join('\\n')
      .slice(0, 2_000);
    const completed = /已完成(?:图片)?生成|生成了?\\s*[1-4四]\\s*张|按.+生成/.test(containerText);
    return {
      images: selectedEntries.map(({ src, width, height }) => ({ src, width, height })),
      message,
      completed,
    };
  })()`, true) as Promise<PageReplyCandidate>;
}

async function fillPromptAndSubmit(win: BrowserWindow, prompt: string): Promise<void> {
  const inserted = await win.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const editor = Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .filter(visible)
      .sort((left, right) => {
        const score = (element) => {
          const hint = [
            element.getAttribute('role') || '',
            element.getAttribute('aria-label') || '',
            element.getAttribute('data-placeholder') || '',
            element.getAttribute('placeholder') || '',
            element.textContent || '',
          ].join(' ');
          return (element.getAttribute('role') === 'textbox' ? 4 : 0)
            + (/描述|消息|图片|prompt/i.test(hint) ? 3 : 0)
            + (element.getBoundingClientRect().top > window.innerHeight * 0.45 ? 1 : 0);
        };
        return score(right) - score(left);
      })[0] || null;
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    editor.replaceChildren();
    document.execCommand('insertText', false, ${JSON.stringify(prompt)});
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(prompt)} }));
    return (editor.innerText || editor.textContent || '').trim().length > 0;
  })()`, true) as boolean;
  if (!inserted) throw codedError('WEB_PAGE_CHANGED', '无法填写豆包生图输入框，网页可能已改版');

  await delay(250);
  const submitted = await win.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const button = Array.from(document.querySelectorAll('button[class*="bg-g-send-msg-btn-bg"]'))
      .find((element) => visible(element) && !element.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`, true) as boolean;
  if (!submitted) throw codedError('WEB_PAGE_CHANGED', '无法找到豆包发送按钮，网页可能已改版');
}

interface DoubaoUploadResult {
  ok: boolean;
  count: number;
  multiple: boolean;
  reason?: string;
}

async function uploadReferenceImages(
  win: BrowserWindow,
  references: NonNullable<GenerateImageRequest['referenceImages']>,
  signal?: AbortSignal,
): Promise<void> {
  if (references.length === 0) return;
  throwIfAborted(signal);

  const payloads = await Promise.all(references.map(async (reference) => {
    const loaded = await readLocalImage(reference);
    return {
      name: reference.name || loaded.image.name || 'reference.png',
      mimeType: loaded.image.mimeType,
      base64: loaded.bytes.toString('base64'),
    };
  }));
  throwIfAborted(signal);

  // 豆包当前页面会预挂载两个图片 input：第一个支持多选，第二个是旧版单图入口。
  // 优先使用带 multiple 的 input，避免把多张参考图折叠成最后一张。
  const result = await win.webContents.executeJavaScript(`(() => {
    const payloads = ${JSON.stringify(payloads)};
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const imageInputs = inputs.filter((input) => {
      const accept = (input.getAttribute('accept') || '').toLowerCase();
      return accept.includes('png') || accept.includes('jpg') || accept.includes('jpeg') || accept.includes('webp') || accept.includes('image');
    });
    const input = imageInputs.find((candidate) => candidate.multiple) || imageInputs[0];
    if (!(input instanceof HTMLInputElement)) return { ok: false, count: 0, multiple: false, reason: '没有找到豆包图片上传控件' };
    if (payloads.length > 1 && !input.multiple) {
      return { ok: false, count: 0, multiple: false, reason: '豆包当前图片上传控件不支持多图' };
    }
    const transfer = new DataTransfer();
    for (const payload of payloads) {
      const binary = atob(payload.base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], payload.name, { type: payload.mimeType }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, count: input.files?.length || 0, multiple: input.multiple };
  })()`, true) as DoubaoUploadResult;

  if (!result?.ok || result.count !== references.length) {
    throw codedError('WEB_UNSUPPORTED', result?.reason || '豆包网页没有接受参考图，请稍后重试');
  }

  // 给网页端的图片预览/上传状态一个稳定窗口，随后再获取基线，避免把预览图当成生成结果。
  await delay(800, signal);
  throwIfAborted(signal);
}

async function waitForGeneratedReply(
  win: BrowserWindow,
  baseline: Set<string>,
  submittedPrompt: string,
  signal?: AbortSignal,
): Promise<PageReplyCandidate> {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  let lastSignature = '';
  let stableSince = Date.now();
  let latest: PageReplyCandidate = { images: [], message: '', completed: false };
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const state = await inspectPage(win);
    if (state.verificationRequired) {
      revealWindow(win);
      throw codedError('WEB_VERIFICATION_REQUIRED', '豆包要求人工验证，请完成验证后重试');
    }
    if (state.loginRequired) {
      revealWindow(win);
      throw codedError('AUTH', '豆包登录已失效，请重新登录后重试');
    }
    latest = await inspectGeneratedReply(win, baseline, submittedPrompt);
    const signature = latest.images.map((image) => image.src).join('\n');
    if (signature !== lastSignature) {
      lastSignature = signature;
      stableSince = Date.now();
    }
    if (latest.images.length >= EXPECTED_IMAGE_COUNT) return latest;
    if (
      latest.images.length > 0
      && latest.completed
      && Date.now() - stableSince >= PARTIAL_RESULT_STABLE_MS
    ) return latest;

    const failure = await win.webContents.executeJavaScript(`(() => {
      const text = (document.body?.innerText || '').slice(-4000);
      const match = text.match(/生成失败|今日[^\\n]{0,20}次数|次数[^\\n]{0,20}(?:用完|不足)|额度不足|操作过于频繁/);
      return match?.[0] || '';
    })()`, true) as string;
    if (failure) throw codedError('WEB_UPSTREAM', `豆包网页提示：${failure}`);
    await delay(POLL_INTERVAL_MS, signal);
  }
  if (latest.images.length > 0) return latest;
  revealWindow(win);
  throw codedError('TIMEOUT', '等待豆包生成结果超时，已打开豆包窗口供你检查');
}

async function imageBytes(win: BrowserWindow, image: PageImage, signal?: AbortSignal): Promise<{ bytes: Buffer; extension: string }> {
  throwIfAborted(signal);
  let dataUrl: string | null = null;
  if (image.src.startsWith('blob:')) {
    dataUrl = await win.webContents.executeJavaScript(`new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(${JSON.stringify(image.src)});
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
        reader.readAsDataURL(blob);
      } catch (error) { reject(error); }
    })`, true) as string;
  } else if (image.src.startsWith('data:')) {
    dataUrl = image.src;
  }

  if (dataUrl) {
    try {
      const decoded = decodeImageDataUrl(dataUrl);
      if (decoded.bytes.length > MAX_IMAGE_BYTES) throw codedError('IMAGE_TOO_LARGE', '豆包返回的图片超过 50 MB');
      return { bytes: decoded.bytes, extension: decoded.extension };
    } catch (error) {
      if ((error as { code?: string }).code === 'IMAGE_TOO_LARGE') throw error;
      throw codedError('IMAGE_DOWNLOAD_FAILED', `豆包返回了无法识别的图片数据：${error instanceof Error ? error.message : '格式无效'}`);
    }
  }

  let response: Response;
  try {
    // The CDN URL is already signed. Chromium rejects a synthetic cross-origin
    // Referer here with ERR_BLOCKED_BY_CLIENT even though the image is visible.
    response = await win.webContents.session.fetch(image.src, { signal });
  } catch (error) {
    throw codedError(
      'IMAGE_DOWNLOAD_FAILED',
      `下载豆包图片失败：${error instanceof Error ? error.message : '网络请求失败'}`,
    );
  }
  if (!response.ok) throw codedError('IMAGE_DOWNLOAD_FAILED', `下载豆包图片失败（HTTP ${response.status}）`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_IMAGE_BYTES) throw codedError('IMAGE_TOO_LARGE', '豆包返回的图片超过 50 MB');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw codedError('IMAGE_TOO_LARGE', '豆包返回的图片超过 50 MB');
  try {
    const decoded = decodeDownloadedImage(bytes, response.headers.get('content-type') ?? '', image.src);
    return { bytes: decoded.bytes, extension: decoded.extension };
  } catch (error) {
    throw codedError('IMAGE_DOWNLOAD_FAILED', `豆包下载内容无法识别为图片：${error instanceof Error ? error.message : '格式无效'}`);
  }
}

export function generateImageWithDoubaoWeb(
  req: GenerateImageRequest,
  signal?: AbortSignal,
): Promise<GenerateImageResult> {
  return serialized(async () => {
    const startedAt = Date.now();
    throwIfAborted(signal);

    const win = await requireAuthenticatedPage(signal);
    try {
      const accountState = await inspectPage(win);
      await uploadReferenceImages(win, req.referenceImages ?? [], signal);
      const baseline = new Set((await listPageImages(win)).map((image) => image.src));
      const usage = reserveDoubaoWebGeneration(undefined, new Date(), accountState.accountName);
      logger.info('占用网页生图次数', `date=${usage.date}`, `used=${usage.used}/${usage.limit}`);
      const submittedPrompt = composeDoubaoWebPrompt(req);
      await fillPromptAndSubmit(win, submittedPrompt);
      const reply = await waitForGeneratedReply(win, baseline, submittedPrompt, signal);
      const historyId = req.jobId ?? ulid();
      const safeName = historyId.replace(/[^A-Za-z0-9_-]/g, '_');
      const outputDirectory = getPaths().pictures;
      await mkdir(outputDirectory, { recursive: true });
      const downloads = await Promise.allSettled(
        reply.images.map(async (image, index) => {
          const downloaded = await imageBytes(win, image, signal);
          const suffix = index === 0 ? '' : `-${index + 1}`;
          const imagePath = join(outputDirectory, `${safeName}${suffix}.${downloaded.extension}`);
          await writeFile(imagePath, downloaded.bytes);
          return { imagePath, actualSize: { width: image.width, height: image.height } };
        }),
      );
      const images = downloads.flatMap((download) => download.status === 'fulfilled' ? [download.value] : []);
      if (images.length === 0) {
        const firstFailure = downloads.find((download) => download.status === 'rejected');
        throw codedError(
          'IMAGE_DOWNLOAD_FAILED',
          firstFailure?.status === 'rejected' && firstFailure.reason instanceof Error
            ? firstFailure.reason.message
            : '豆包图片下载失败',
        );
      }
      logger.info(
        '网页生图完成',
        `history=${historyId}`,
        `images=${images.length}/${reply.images.length}`,
      );
      return {
        historyId,
        status: 'success',
        imagePath: images[0].imagePath,
        images,
        providerResponse: {
          kind: 'doubao-web',
          message: reply.message || undefined,
          expectedImageCount: req.referenceImages?.length ? reply.images.length : EXPECTED_IMAGE_COUNT,
          receivedImageCount: images.length,
        },
        cost: 0,
        durationMs: Date.now() - startedAt,
        actualSize: images[0].actualSize,
      };
    } catch (error) {
      if ((error as { code?: string }).code !== 'CANCELLED') revealWindow(win);
      throw error;
    }
  });
}

export function disposeDoubaoWebBrowser(): void {
  stopLoginPoller();
  loginListeners.clear();
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.destroy();
  browserWindow = null;
}

export const doubaoWebRuntime = {
  validate: validateDoubaoWebSession,
  generateImage: generateImageWithDoubaoWeb,
};
