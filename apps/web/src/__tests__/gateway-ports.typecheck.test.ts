import { describe, expect, it } from "vitest";
import type {
  AccountGateway,
  GenerationGateway,
  HistoryGateway,
  PlatformServices,
  PromptGateway,
  WorkbenchGateway,
} from "@musefold/domain";
import type { WebGateway } from "../runtime";

type SharedGatewayPorts = PromptGateway &
  WorkbenchGateway &
  GenerationGateway &
  HistoryGateway &
  AccountGateway &
  PlatformServices;

function assertAssignable<T>(_value: T): void {}

/**
 * WebGateway implements 声明推迟到 web 收口补卡。
 * 本文件用 satisfies / 赋值兼容断言锁住端口与 WebGateway 形状，避免两端漂移。
 */
const _asPrompt = {} as WebGateway satisfies PromptGateway;
const _asWorkbench = {} as WebGateway satisfies WorkbenchGateway;
const _asGeneration = {} as WebGateway satisfies GenerationGateway;
const _asHistory = {} as WebGateway satisfies HistoryGateway;
const _asAccount = {} as WebGateway satisfies AccountGateway;
const _asPlatform = {} as WebGateway satisfies PlatformServices;
const _webGatewayAsPorts = {} as WebGateway satisfies SharedGatewayPorts;

describe("gateway port compatibility", () => {
  it("keeps WebGateway assignable to the six domain ports", () => {
    assertAssignable<PromptGateway>({} as WebGateway);
    assertAssignable<WorkbenchGateway>({} as WebGateway);
    assertAssignable<GenerationGateway>({} as WebGateway);
    assertAssignable<HistoryGateway>({} as WebGateway);
    assertAssignable<AccountGateway>({} as WebGateway);
    assertAssignable<PlatformServices>({} as WebGateway);
    assertAssignable<SharedGatewayPorts>({} as WebGateway);
    expect([
      _asPrompt,
      _asWorkbench,
      _asGeneration,
      _asHistory,
      _asAccount,
      _asPlatform,
      _webGatewayAsPorts,
    ]).toHaveLength(7);
  });
});
