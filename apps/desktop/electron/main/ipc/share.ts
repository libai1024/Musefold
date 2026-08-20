import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { IPC, type ShareRenderCardRequest, type ShareImportRequest } from '@shared/types/ipc';
import type { Prompt, PromptParams } from '@shared/types/models';
import type { PromptTarget } from '@shared/types/enums';
import {
  buildShareDeeplink,
  sanitizeSharePayload,
  type SharePayload,
} from '@shared/share';
import { parseShareDeeplink } from '@shared/share';
import { promptsRepo } from '@musefold/core/db/repositories/prompts';
import { consumeQueuedShareImports } from '../share-protocol';

const CARD_WIDTH = 720;
const CARD_HEIGHT = 960;
const PREVIEW_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const TARGETS = new Set<PromptTarget>([
  'a1111',
  'comfyui',
  'midjourney',
  'flux',
  'sd3',
  'openai',
  'generic',
]);

export function registerShareHandlers(): void {
  ipcMain.handle(IPC.SHARE_BUILD_DEEPLINK, (_e, req: { payload?: SharePayload } = {}) => ({
    deeplink: buildShareDeeplink(sanitizeSharePayload(req.payload, { includePreview: false })),
  }));

  ipcMain.handle(IPC.SHARE_PARSE_DEEPLINK, (_e, req: { url?: string } = {}) => ({
    payload: parseShareDeeplink(req.url ?? ''),
  }));

  ipcMain.handle(IPC.SHARE_IMPORT, (_e, req: ShareImportRequest) => {
    const payload = sanitizeSharePayload(req?.payload, { includePreview: false });
    return { prompt: importSharedPrompt(payload) };
  });

  ipcMain.handle(IPC.SHARE_CONSUME_PENDING, () => ({ payloads: consumeQueuedShareImports() }));

  ipcMain.handle(IPC.SHARE_RENDER_CARD, async (_e, req: ShareRenderCardRequest = {}) => {
    const payload = await resolveSharePayload(req);
    const pngPath = await renderShareCardToPng(payload, req.savePath);
    return { pngPath, deeplink: buildShareDeeplink(payload) };
  });
}

async function resolveSharePayload(req: ShareRenderCardRequest): Promise<SharePayload> {
  if (req.promptId) {
    const prompt = promptsRepo.get(req.promptId);
    if (!prompt || prompt.deletedAt !== null) throw new Error('NOT_FOUND: 提示词不存在或已删除');
    return promptToSharePayload(prompt);
  }
  if (req.payload) return sanitizeSharePayload(req.payload, { includePreview: true });
  throw new Error('INVALID_SHARE_PAYLOAD: 缺少 promptId 或 payload');
}

async function promptToSharePayload(prompt: Prompt): Promise<SharePayload> {
  const target = inferPromptTarget(prompt.params);
  const payload = sanitizeSharePayload(
    {
      title: prompt.title,
      content: prompt.content,
      contentNegative: prompt.contentNegative ?? undefined,
      params: prompt.params ?? undefined,
      target,
    },
    { includePreview: false },
  );

  const previewDataUrl = await readPreviewAsDataUrl(prompt.previewImagePath);
  if (previewDataUrl) payload.previewDataUrl = previewDataUrl;
  return payload;
}

function importSharedPrompt(payload: SharePayload): Prompt {
  const params = payload.params ? { ...payload.params } : undefined;
  if (payload.target) {
    const base: PromptParams = params ?? { schemaVersion: 1 };
    base.promptTarget = payload.target;
    return promptsRepo.create({
      title: payload.title,
      content: payload.content,
      contentNegative: payload.contentNegative,
      params: base,
      source: 'shared',
    });
  }

  return promptsRepo.create({
    title: payload.title,
    content: payload.content,
    contentNegative: payload.contentNegative,
    params,
    source: 'shared',
  });
}

function inferPromptTarget(params: PromptParams | null | undefined): PromptTarget | undefined {
  if (!params) return undefined;
  const explicit = params.promptTarget;
  if (typeof explicit === 'string' && TARGETS.has(explicit as PromptTarget)) {
    return explicit as PromptTarget;
  }
  if (
    params.size !== undefined ||
    params.quality !== undefined ||
    params.background !== undefined ||
    params.moderation !== undefined
  ) {
    return 'openai';
  }
  return undefined;
}

async function readPreviewAsDataUrl(sourcePath: string | null): Promise<string | undefined> {
  if (!sourcePath) return undefined;
  const path = resolve(sourcePath);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size > PREVIEW_IMAGE_MAX_BYTES) return undefined;
  const mime = mimeForPath(path);
  if (!mime) return undefined;
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) return undefined;
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function mimeForPath(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return null;
  }
}

async function renderShareCardToPng(payload: SharePayload, explicitPath?: string): Promise<string> {
  const dir = await ensureShareDir();
  const pngPath = explicitPath?.trim()
    ? resolve(explicitPath)
    : join(dir, `musefold-share-${Date.now()}.png`);
  const htmlPath = join(dir, `share-card-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  await writeFile(htmlPath, renderShareCardHtml(payload), 'utf8');

  const win = new BrowserWindow({
    show: false,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#111217',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });

  try {
    await win.loadFile(htmlPath);
    await win.webContents.executeJavaScript(`
      Promise.all(Array.from(document.images).map((img) => img.complete
        ? true
        : new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          })
      )).then(() => document.fonts?.ready ?? true)
    `);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    });
    if (image.isEmpty()) throw new Error('SHARE_CARD_EMPTY: 分享卡片渲染为空');
    await mkdir(dirname(pngPath), { recursive: true });
    await writeFile(pngPath, image.toPNG());
    return pngPath;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await unlink(htmlPath).catch(() => {});
  }
}

async function ensureShareDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'shares');
  await mkdir(dir, { recursive: true });
  return dir;
}

function renderShareCardHtml(payload: SharePayload): string {
  const chips = paramChips(payload);
  const hasPreview = Boolean(payload.previewDataUrl);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: ${CARD_WIDTH}px;
      height: ${CARD_HEIGHT}px;
      overflow: hidden;
      background: #101116;
      color: #f3f4f7;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .card {
      position: relative;
      display: flex;
      height: 100%;
      flex-direction: column;
      gap: 22px;
      padding: 38px;
      background:
        radial-gradient(circle at 20% 8%, rgba(84, 190, 255, 0.18), transparent 28%),
        linear-gradient(155deg, #181a22 0%, #101116 58%, #17121a 100%);
      border: 1px solid rgba(255,255,255,0.11);
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      color: rgba(243,244,247,0.68);
      font-size: 20px;
      font-weight: 650;
      letter-spacing: 0;
    }
    .mark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }
    .spark {
      display: inline-grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border-radius: 10px;
      background: linear-gradient(135deg, #4fb4ff, #9be56b);
      color: #091016;
      font-size: 21px;
      font-weight: 900;
    }
    .hint { font-size: 14px; color: rgba(243,244,247,0.52); }
    .preview {
      display: ${hasPreview ? 'block' : 'none'};
      width: 100%;
      height: 360px;
      object-fit: cover;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 24px 70px rgba(0,0,0,0.34);
      background: #0c0d11;
    }
    .textOnly {
      display: ${hasPreview ? 'none' : 'grid'};
      height: 310px;
      place-items: center;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.10);
      background: linear-gradient(135deg, rgba(79,180,255,0.10), rgba(155,229,107,0.09));
      color: rgba(243,244,247,0.70);
      font-size: 22px;
      font-weight: 700;
    }
    h1 {
      margin: 0;
      color: #ffffff;
      font-size: 40px;
      line-height: 1.14;
      font-weight: 760;
      letter-spacing: 0;
    }
    .prompt {
      display: -webkit-box;
      margin: 0;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: ${hasPreview ? 7 : 10};
      color: rgba(243,244,247,0.80);
      font-size: 22px;
      line-height: 1.52;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .negative {
      display: -webkit-box;
      margin: 0;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      border-left: 3px solid rgba(255, 108, 108, 0.65);
      padding-left: 14px;
      color: rgba(243,244,247,0.58);
      font-size: 17px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: auto;
    }
    .chip {
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 999px;
      background: rgba(255,255,255,0.07);
      padding: 8px 12px;
      color: rgba(243,244,247,0.72);
      font-size: 14px;
      font-weight: 650;
    }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid rgba(255,255,255,0.10);
      padding-top: 16px;
      color: rgba(243,244,247,0.48);
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <span class="mark"><span class="spark">M</span> Musefold</span>
      <span class="hint">P2P Prompt Card</span>
    </div>
    ${hasPreview ? `<img class="preview" src="${escapeAttr(payload.previewDataUrl ?? '')}" />` : '<div class="textOnly">Musefold Share</div>'}
    <h1>${escapeHtml(payload.title)}</h1>
    <p class="prompt">${escapeHtml(payload.content)}</p>
    ${payload.contentNegative ? `<p class="negative">Negative · ${escapeHtml(payload.contentNegative)}</p>` : ''}
    <div class="chips">${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join('')}</div>
    <div class="footer">
      <span>musefold://import</span>
      <span>Local first · No cloud account required</span>
    </div>
  </main>
</body>
</html>`;
}

function paramChips(payload: SharePayload): string[] {
  const chips: string[] = [];
  if (payload.target) chips.push(`Target ${payload.target}`);
  const params = payload.params;
  if (!params) return chips.length ? chips : ['Prompt'];
  if (typeof params.ratioId === 'string') chips.push(`Ratio ${params.ratioId}`);
  else if (typeof params.aspectRatio === 'string') chips.push(`Ratio ${params.aspectRatio}`);
  if (typeof params.size === 'string') chips.push(`Size ${params.size}`);
  if (typeof params.quality === 'string') chips.push(`Quality ${params.quality}`);
  if (typeof params.n === 'number') chips.push(`Count ${params.n}`);
  if (typeof params.steps === 'number') chips.push(`Steps ${params.steps}`);
  if (typeof params.cfg === 'number') chips.push(`CFG ${params.cfg}`);
  if (typeof params.sampler === 'string') chips.push(params.sampler);
  if (chips.length === 0) chips.push('Prompt');
  return chips.slice(0, 8);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
