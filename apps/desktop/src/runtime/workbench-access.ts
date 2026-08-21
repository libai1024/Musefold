/**
 * V13-REUSE-01：工作台会话与写面的编排入口。
 * 其它 feature 不得直连 `features/generation/workbench`。
 */
export {
  useDesktopWorkbenchSessionList,
  useGenerationWorkbenchStore,
} from '../features/generation/workbench/store';
export { WORKBENCH_SESSION_RESTART_REQUIRED } from '../features/generation/workbench/sessionErrors';
