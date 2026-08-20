// DesktopGateway 统一错误类。未实现的端口方法必须抛 NotImplemented，禁止裸 Error。

export class DesktopGatewayError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DesktopGatewayError';
  }
}

/**
 * 骨架卡里语义对不齐、不能老实映射的端口方法。
 * 消息格式：`<method>: <原因>`，方便 GW-03 之后按方法名检索。
 */
export class DesktopGatewayNotImplementedError extends DesktopGatewayError {
  constructor(methodAndReason: string) {
    super(methodAndReason);
    this.name = 'DesktopGatewayNotImplementedError';
  }
}
