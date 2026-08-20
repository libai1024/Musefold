import type {
  CreateWorkbenchSession,
  UpdateWorkbenchSession,
  WorkbenchSession,
  WorkbenchSessionListQuery,
  WorkbenchSessionPage,
} from '@musefold/contracts';

/**
 * 工作台会话 CRUD。草稿保存走 updateWorkbenchSession 的 draft 字段，
 * 不另造 saveDraft。
 */
export interface WorkbenchGateway {
  listWorkbenchSessions(
    query: WorkbenchSessionListQuery,
  ): Promise<WorkbenchSessionPage>;
  getWorkbenchSession(id: string): Promise<WorkbenchSession>;
  createWorkbenchSession(
    input: CreateWorkbenchSession,
  ): Promise<WorkbenchSession>;
  updateWorkbenchSession(
    id: string,
    input: UpdateWorkbenchSession,
  ): Promise<WorkbenchSession>;
  deleteWorkbenchSession(
    id: string,
    expectedVersion: number,
  ): Promise<WorkbenchSession>;
}
