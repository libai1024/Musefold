import { ipcMain } from 'electron';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type { EnsureWorkbenchSessionCommand, WorkbenchSessionListQuery } from '@musefold/desktop-contracts/workbench';
import type { ImageProviderResponseSummary } from '@musefold/desktop-contracts/providers';
import { getDb } from '@musefold/core/db';
import { parseJsonColumn } from '@musefold/core/db/json';
import { createWorkbenchRepositories } from '@musefold/core/db/repositories/workbench';

function repositories() {
  return createWorkbenchRepositories(getDb());
}

function requiredId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 160) throw new Error('对话 ID 无效');
  return id;
}

function providerResponseFromParams(raw: unknown): ImageProviderResponseSummary | undefined {
  const params = parseJsonColumn<Record<string, unknown> | null>(raw, null);
  const value = params?.providerResponse;
  if (!value || typeof value !== 'object') return undefined;
  const summary = value as Partial<ImageProviderResponseSummary>;
  if (
    summary.kind !== 'doubao-web'
    || typeof summary.expectedImageCount !== 'number'
    || typeof summary.receivedImageCount !== 'number'
  ) return undefined;
  return {
    kind: 'doubao-web',
    expectedImageCount: summary.expectedImageCount,
    receivedImageCount: summary.receivedImageCount,
    ...(typeof summary.message === 'string' && summary.message.trim()
      ? { message: summary.message }
      : {}),
  };
}

function getSessionDocument(id: string) {
  const document = repositories().sessions.getDocument(requiredId(id));
  if (!document) return null;
  const db = getDb();
  const statement = db.prepare(
    `SELECT prompt_id, prompt_title, excerpt, scope
     FROM history_prompt_references
     WHERE history_id = ?
     ORDER BY sort_order`,
  );
  const getHistoryParams = db.prepare('SELECT params FROM history WHERE id = ?');
  return {
    ...document,
    runs: document.runs.map((item) => ({
      ...item,
      providerResponse: providerResponseFromParams(
        (getHistoryParams.get(item.run.id) as { params: string | null } | undefined)?.params,
      ),
      promptReferences: (statement.all(item.run.id) as Array<{
        prompt_id: string | null;
        prompt_title: string;
        excerpt: string;
        scope: 'full' | 'excerpt';
      }>).map((row) => ({
        promptId: row.prompt_id ?? '',
        title: row.prompt_title,
        text: row.excerpt,
        scope: row.scope,
      })),
    })),
  };
}

export function registerWorkbenchSessionHandlers(): void {
  ipcMain.handle(IPC.WORKBENCH_SESSION_ENSURE, (_event, command: EnsureWorkbenchSessionCommand) =>
    repositories().sessions.ensure({
      ...command,
      id: requiredId(command?.id),
    }));
  ipcMain.handle(IPC.WORKBENCH_SESSION_LIST, (_event, query?: WorkbenchSessionListQuery) =>
    repositories().sessions.list(query));
  ipcMain.handle(IPC.WORKBENCH_SESSION_GET, (_event, id: string) =>
    getSessionDocument(id));
  ipcMain.handle(IPC.WORKBENCH_SESSION_RENAME, (_event, id: string, title: string) =>
    repositories().sessions.rename(requiredId(id), title));
  ipcMain.handle(IPC.WORKBENCH_SESSION_ARCHIVE, (_event, id: string, archived = true) =>
    repositories().sessions.archive(requiredId(id), Boolean(archived)));
  ipcMain.handle(IPC.WORKBENCH_SESSION_DELETE, (_event, id: string) =>
    repositories().sessions.softDelete(requiredId(id)));
}
