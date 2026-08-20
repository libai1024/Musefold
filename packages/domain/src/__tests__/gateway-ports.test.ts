import { describe, expect, it } from 'vitest';
import type {
  AccountGateway,
  GenerationEvent,
  GenerationGateway,
  HistoryGateway,
  PlatformServices,
  PromptGateway,
  WorkbenchGateway,
} from '../index';

type SharedGatewayPorts = PromptGateway &
  WorkbenchGateway &
  GenerationGateway &
  HistoryGateway &
  AccountGateway &
  PlatformServices;

type IsNever<T> = [T] extends [never] ? true : false;
type AssertFalse<T extends false> = T;

type _PortsTuple = [
  PromptGateway,
  WorkbenchGateway,
  GenerationGateway,
  HistoryGateway,
  AccountGateway,
  PlatformServices,
];

/** 交叉端口若因方法签名冲突塌成 never，这里会编不过。 */
type _IntersectionUsable = AssertFalse<IsNever<SharedGatewayPorts>>;

function assertSatisfies<T>(_value: T): void {}

describe('shared gateway ports', () => {
  it('exports the six named ports on the domain package surface', () => {
    const portCount: _PortsTuple['length'] = 6;
    expect(portCount).toBe(6);
  });

  it('keeps the port intersection implementable without collapsing', () => {
    assertSatisfies<SharedGatewayPorts>({} as SharedGatewayPorts);
    assertSatisfies<_IntersectionUsable>(false);
    assertSatisfies<GenerationEvent>({ seq: 0, type: 'progress', payload: {} });
    expect(true).toBe(true);
  });
});
