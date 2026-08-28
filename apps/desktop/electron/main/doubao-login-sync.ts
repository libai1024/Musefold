// 豆包网页登录态 → providers 表同步(V25-UI-SPEC §0.2:豆包主进程语义保留,渲染层暂缓)。
// 生图编排(core-instance 注入的 doubaoWebRuntime)依赖 has_key 判断连接可用性,
// 该同步原挂在旧渲染层 providers IPC 注册里,M5c 起独立为主进程装配项。

import { getDb } from '@musefold/core/db';
import { subscribeDoubaoWebLogin } from '../doubao-web/browser-service';

export function startDoubaoLoginSync(): void {
  subscribeDoubaoWebLogin((status) => {
    getDb()
      .prepare(
        "UPDATE providers SET has_key = ?, key_suffix = ?, updated_at = ? WHERE type = 'doubao-web'",
      )
      .run(status.loggedIn ? 1 : 0, status.loggedIn ? '网页会话' : null, Date.now());
  });
}
