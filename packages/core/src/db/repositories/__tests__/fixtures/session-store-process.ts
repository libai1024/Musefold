import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { WorkbenchSessionStore } from '../../workbench-sessions';

const [path, id] = process.argv.slice(2);
if (!path || !id) throw new Error('Missing owned fixture path or Session id');
const db = new Database(path, { timeout: 10_000 });
takeoverDesktopDatabase(db);
const store = new WorkbenchSessionStore(db);
const observed = store.get(id);
process.on('message', (command: { action: 'update' | 'read'; title?: string }) => {
  if (command.action === 'update') {
    process.send?.({ type: 'attempting', pid: process.pid });
    try {
      const record = store.update(id, {
        expectedVersion: observed.row.version,
        title: command.title,
        draft: {
          prompt: command.title ?? '',
          negative: '',
          params: {},
          promptReferenceIds: [],
          promptReferenceSelections: [],
        },
      });
      process.send?.({ type: 'result', pid: process.pid, record });
    } catch (error) {
      process.send?.({ type: 'result', pid: process.pid, code: (error as { code?: string }).code });
    }
  } else process.send?.({ type: 'result', pid: process.pid, record: store.get(id) });
  db.close();
  process.disconnect();
});
process.send?.({ type: 'ready', pid: process.pid, record: observed });
