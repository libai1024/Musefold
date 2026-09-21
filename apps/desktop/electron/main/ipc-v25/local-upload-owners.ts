import { webContents } from 'electron';
import { createLocalUploadOwner } from '@musefold/core/services/local-upload-owner';
import { BridgeError } from './envelope';

const owners = new Map<
  number,
  { owner: ReturnType<typeof createLocalUploadOwner>; close: () => void }
>();

/** Called after application admission closes and requests drain, before either database closes. */
export function closeWindowUploadOwners(): void {
  for (const { close } of [...owners.values()]) close();
}

/** Window identities come only from the trusted IPC event, never from upload payloads. */
export function windowUploadOwner(senderId: number | undefined) {
  if (!Number.isSafeInteger(senderId) || !senderId || senderId <= 0)
    throw new BridgeError('FORBIDDEN', '参考图上传需要有效窗口');
  const target = webContents.fromId(senderId);
  if (!target || target.isDestroyed()) throw new BridgeError('FORBIDDEN', '参考图所属窗口已关闭');
  const existing = owners.get(senderId);
  if (existing) return existing.owner;
  const owner = createLocalUploadOwner();
  const navigated = (
    details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
  ) => {
    if (details.isMainFrame && !details.isSameDocument) close();
  };
  const close = () => {
    if (owners.get(senderId)?.owner === owner) owners.delete(senderId);
    target.removeListener('destroyed', close);
    target.removeListener('render-process-gone', close);
    target.removeListener('did-start-navigation', navigated);
    owner.close();
  };
  owners.set(senderId, { owner, close });
  target.once('destroyed', close);
  target.once('render-process-gone', close);
  target.on('did-start-navigation', navigated);
  return owner;
}
