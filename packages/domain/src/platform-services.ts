/**
 * 平台能力端口（toast / 下载 / 剪贴板 / 外链一类）。
 * WebGateway 现行方法面不含这些能力，故不发明方法；空接口是有意贴合现状。
 * 宿主侧若日后把对应辅助函数收进 WebGateway，再按同样形状补签名。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- WebGateway 无对应方法，空接口避免发明新抽象
export interface PlatformServices {}
