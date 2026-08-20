// @musefold/core 的 Electron 端口适配器（V04-CORE-02）。
// 全部是薄委托：路径复用 system/paths，密钥复用 security/keychain（safeStorage），
// 日志复用 system/logger（自带脱敏）。core 由此与 Electron 解耦，
// headless 守护（P4）提供同名端口的另一套实现。

import type { PathsPort, SecretsPort } from '@musefold/core';
import { getPaths } from '../system/paths';
import { deleteApiKey, loadApiKey, saveApiKey } from '../security/keychain';
import { ElectronAiSecretKeychain } from '../security/ai-keychain';

/** 惰性求值：E2E 在启动早期覆盖 userData，端口不得缓存路径快照。 */
export function electronPathsPort(): PathsPort {
  return {
    get dataDir() {
      return getPaths().userData;
    },
    get picturesDir() {
      return getPaths().pictures;
    },
    get logsDir() {
      return getPaths().logs;
    },
  };
}

export function electronSecretsPort(): SecretsPort {
  const aiKeychain = new ElectronAiSecretKeychain();
  return {
    getProviderKey: async (providerId) => loadApiKey(providerId),
    setProviderKey: async (providerId, key) => saveApiKey(providerId, key),
    deleteProviderKey: async (providerId) => deleteApiKey(providerId),
    getAiConnectionKey: async (connectionId) => aiKeychain.load(connectionId),
    setAiConnectionKey: async (connectionId, key) => aiKeychain.save(connectionId, key),
    deleteAiConnectionKey: async (connectionId) => aiKeychain.delete(connectionId),
  };
}
