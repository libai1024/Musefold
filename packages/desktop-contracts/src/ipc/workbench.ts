// packages/desktop-contracts/src/ipc/workbench.ts
// workbenchSession 域：Api namespace（V13-GOV-04 自 ipc.ts 分域拆出）。

import type {
  EnsureWorkbenchSessionCommand,
  WorkbenchSession,
  WorkbenchSessionDocument,
  WorkbenchSessionListQuery,
  WorkbenchSessionListResult,
} from "../workbench";

export interface WorkbenchSessionApi {
  ensure: (command: EnsureWorkbenchSessionCommand) => Promise<WorkbenchSession>;
  list: (query?: WorkbenchSessionListQuery) => Promise<WorkbenchSessionListResult>;
  get: (id: string) => Promise<WorkbenchSessionDocument | null>;
  rename: (id: string, title: string) => Promise<WorkbenchSession>;
  archive: (id: string, archived?: boolean) => Promise<WorkbenchSession>;
  delete: (id: string) => Promise<WorkbenchSession>;
}
