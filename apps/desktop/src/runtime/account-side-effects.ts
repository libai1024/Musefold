/**
 * 账号登录态翻转后的跨域副作用（V13-REUSE-03）。
 *
 * 登录/登出/换服务器会让主进程创建或回收托管服务商与 Agent 连接，渲染层两份
 * 列表必须跟着重载，否则侧栏与设置里会出现「登录了却看不到」或「登出后还能选中
 * 幽灵托管条目」。这条刷新策略属于生图/设置域，放 runtime 而不是 account store，
 * 账号域因此不需要知道谁在依赖它（SPLIT-03 的 workbench-side-effects 同型）。
 */
export async function reloadAccountManagedStacks(): Promise<void> {
  const [generation, aiConnection] = await Promise.all([
    import('../features/generation/store'),
    import('../features/settings/ai-connection-store'),
  ]);
  await Promise.allSettled([
    generation.useGenerationStore.getState().loadProviders(),
    aiConnection.useAiConnectionStore.getState().load(),
  ]);
}
