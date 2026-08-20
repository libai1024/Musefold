import type { ImageGenerationProgress } from '@musefold/desktop-contracts/providers';
import type { DesktopGateway } from '../../../runtime/desktop-gateway';
import { gateway } from '../../../runtime/gateway-context';

/** Workbench host IO. State/controller code only depends on this narrow gateway surface. */
export type WorkbenchIO = Pick<
  DesktopGateway,
  | 'ensureWorkbenchSession'
  | 'listDesktopWorkbenchSessions'
  | 'getDesktopWorkbenchSession'
  | 'renameWorkbenchSession'
  | 'archiveWorkbenchSession'
  | 'deleteWorkbenchSession'
  | 'generateImage'
  | 'cancelImage'
  | 'retryImage'
  | 'onImageGenerationProgress'
>;

let workbenchIO: WorkbenchIO = gateway.desktop;

export function getWorkbenchIO(): WorkbenchIO {
  return workbenchIO;
}

export function setWorkbenchIOForTests(next: WorkbenchIO): void {
  workbenchIO = next;
}

export function resetWorkbenchIOForTests(): void {
  workbenchIO = gateway.desktop;
}

export function subscribeToWorkbenchGenerationProgress(
  callback: (progress: ImageGenerationProgress) => void,
): () => void {
  if (typeof window === 'undefined' || window.api == null) return () => undefined;
  return workbenchIO.onImageGenerationProgress(callback);
}
