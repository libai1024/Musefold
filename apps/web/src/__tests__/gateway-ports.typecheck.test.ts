import { describe, expect, it } from 'vitest';
import type {
  AccountGateway,
  GenerationGateway,
  HistoryGateway,
  PromptGateway,
  WorkbenchGateway,
} from '@musefold/domain';
import type { WebGateway } from '../runtime';

type SharedGatewayPorts = PromptGateway &
  WorkbenchGateway &
  GenerationGateway &
  HistoryGateway &
  AccountGateway;

function assertAssignable<T>(_value: T): void {}

/** WebGateway 显式继承五数据端口；PlatformServices 由宿主另行注入 page controller。 */
const _asPrompt = {} as WebGateway satisfies PromptGateway;
const _asWorkbench = {} as WebGateway satisfies WorkbenchGateway;
const _asGeneration = {} as WebGateway satisfies GenerationGateway;
const _asHistory = {} as WebGateway satisfies HistoryGateway;
const _asAccount = {} as WebGateway satisfies AccountGateway;
const _webGatewayAsPorts = {} as WebGateway satisfies SharedGatewayPorts;

describe('gateway port compatibility', () => {
  it('keeps WebGateway assignable to the five domain data ports', () => {
    assertAssignable<PromptGateway>({} as WebGateway);
    assertAssignable<WorkbenchGateway>({} as WebGateway);
    assertAssignable<GenerationGateway>({} as WebGateway);
    assertAssignable<HistoryGateway>({} as WebGateway);
    assertAssignable<AccountGateway>({} as WebGateway);
    assertAssignable<SharedGatewayPorts>({} as WebGateway);
    expect([
      _asPrompt,
      _asWorkbench,
      _asGeneration,
      _asHistory,
      _asAccount,
      _webGatewayAsPorts,
    ]).toHaveLength(6);
  });
});
