import type { AccountImageSource } from '../../lib/ai-access';
import { verifyAiAccessConnectivity } from '../../lib/ai-access';
import { toast } from '../../stores/toast';
import { useAccountStore } from '@renderer/runtime/account-access';
import { useDoubaoAccountStore } from '@renderer/runtime/account-access';
import { useGenerationStore } from '@renderer/runtime/generation-access';
import { useAiConnectionStore } from './ai-connection-store';
import { useSettingsStore } from './store';

export async function switchAccountSource(target: AccountImageSource): Promise<void> {
  const connectionState = useAiConnectionStore.getState();
  if (!connectionState.loaded && !connectionState.loading) await connectionState.load();

  const generation = useGenerationStore.getState();
  const connections = useAiConnectionStore.getState();
  const previousProviderId = generation.activeProviderId;
  const previousConnection = connections.connections.find((connection) => connection.isActive) ?? null;
  const doubaoProvider = generation.providers.find((provider) => provider.type === 'doubao-web') ?? null;
  const officialProvider = generation.providers.find((provider) => provider.managedBy === 'account') ?? null;
  const officialConnection = connections.connections.find((connection) => connection.managedBy === 'account') ?? null;
  let connectivityPassed = false;

  try {
    if (target === 'doubao') {
      if (!doubaoProvider?.hasKey) throw new Error('请先完成豆包扫码登录');
      const result = await generation.testProvider(doubaoProvider.id);
      if (result.state !== 'ok') throw new Error(result.message || '豆包网页会话尚未登录');
      connectivityPassed = true;
      if (previousProviderId !== doubaoProvider.id) await generation.setActive(doubaoProvider.id);
      await useDoubaoAccountStore.getState().refreshStatus();
      useSettingsStore.getState().setAccountImageSource('doubao');
      toast.success('已切换到豆包账号');
      return;
    }

    if (!officialProvider || !officialConnection) throw new Error('请先登录 Musefold 官方账号');
    await verifyAiAccessConnectivity([
      {
        label: '账号',
        run: async () => {
          const status = await useAccountStore.getState().refreshQuota();
          return {
            ok: status.loggedIn && status.health === 'ok',
            message: status.health === 'token-invalid' ? '登录已失效' : '账号服务器不可达',
          };
        },
      },
      {
        label: '生图',
        run: async () => {
          const result = await generation.testProvider(officialProvider.id);
          return { ok: result.state === 'ok', message: result.message || '官方生图模型连接失败' };
        },
      },
      {
        label: 'Agent',
        run: async () => {
          const result = await connections.validate(officialConnection.id);
          return { ok: result.ok, message: result.message || '官方 Agent 连接失败' };
        },
      },
    ]);
    connectivityPassed = true;
    if (previousProviderId !== officialProvider.id) await generation.setActive(officialProvider.id);
    if (previousConnection?.id !== officialConnection.id) await connections.setActive(officialConnection.id);
    useSettingsStore.getState().setAccountImageSource('official');
    toast.success('已切换到 Musefold 官方账号');
  } catch (error) {
    await Promise.allSettled([
      previousProviderId && useGenerationStore.getState().activeProviderId !== previousProviderId
        ? useGenerationStore.getState().setActive(previousProviderId)
        : Promise.resolve(),
      previousConnection && useAiConnectionStore.getState().connections.find((connection) => connection.isActive)?.id !== previousConnection.id
        ? useAiConnectionStore.getState().setActive(previousConnection.id)
        : Promise.resolve(),
    ]);
    toast.error(
      connectivityPassed ? '账号切换失败' : '联通性测试未通过',
      error instanceof Error ? error.message : '请稍后重试。',
    );
    throw error;
  }
}
