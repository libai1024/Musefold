import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * 首启引导(U01-onboarding)E2E 夹具。
 *
 * 引导层的触发条件是「未完成哨兵 + 无可用生图通道」,而既有 E2E 一律是未登录、无本地
 * Provider、豆包未登录的干净环境——不预置哨兵,每个屏都会被引导层盖住。所以除引导自身的
 * spec 外,所有 spec 都默认「已完成引导」:Web 经 addInitScript 落 localStorage 偏好,
 * 桌面经 userData 下的偏好文件(launchV25App 默认调用)。
 *
 * 偏好只写 `theme`/`language`/`onboardingCompletedAt` 三个键:前两者是 `appPreferencesSchema`
 * 唯一必填项,其余字段由契约 `.default()` 补齐,新增偏好字段不需要回来改夹具。
 */

/** 哨兵取一个固定的过去时刻:E2E 不关心具体值,只关心「非 null」。 */
export const ONBOARDING_COMPLETED_AT = '2026-01-01T00:00:00.000Z';

/** Web 宿主偏好存储键(apps/web-next/src/lib/web-gateway.ts 的 PREFERENCES_STORAGE_KEY)。 */
export const WEB_PREFERENCES_STORAGE_KEY = 'musefold.preferences.v1';

/** 桌面偏好文件(electron/main/ipc-v25/gateway-bridge.ts 的 PREFERENCES_FILE)。 */
export const DESKTOP_PREFERENCES_FILE = 'v25-preferences.json';

/**
 * Web:在页面脚本之前把完成哨兵写进 localStorage 偏好。
 * 已有偏好则只补哨兵(不覆盖用例自己预置的主题/密度等)。
 * 每次导航都会重跑,所以刷新后依旧「已完成」——除非用例自己清了 key。
 */
export async function seedOnboardingCompleted(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, completedAt }) => {
      try {
        const raw = window.localStorage.getItem(key);
        const current = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (current.onboardingCompletedAt) return;
        window.localStorage.setItem(
          key,
          JSON.stringify({
            theme: 'system',
            language: 'zh-CN',
            ...current,
            onboardingCompletedAt: completedAt,
          }),
        );
      } catch {
        // localStorage 不可用(隐私模式等):夹具静默降级,用例自己会因引导层可见而失败。
      }
    },
    { key: WEB_PREFERENCES_STORAGE_KEY, completedAt: ONBOARDING_COMPLETED_AT },
  );
}

/**
 * Web:清掉偏好里的哨兵(引导 spec 的「首次启动」起点)。
 * 只在本标签页首次导航清理一次 —— 否则刷新会把引导自己写下的哨兵也一起抹掉,
 * 「跳过后不重放」这类用例就永远看不到真实行为。
 */
export async function seedOnboardingPending(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      const marker = `${key}:e2e-pending-cleared`;
      if (window.sessionStorage.getItem(marker)) return;
      window.sessionStorage.setItem(marker, '1');
      window.localStorage.removeItem(key);
    } catch {
      // 同上:不可用即无需清理。
    }
  }, WEB_PREFERENCES_STORAGE_KEY);
}

/**
 * 桌面:把完成哨兵写进 userData 偏好文件(launchV25App 在启动前调用)。
 * 复用目录里已有偏好时只补哨兵,不动其它键(重启持久化类用例靠这个)。
 */
export function seedOnboardingCompletedFile(userDataDir: string): void {
  const file = join(userDataDir, DESKTOP_PREFERENCES_FILE);
  let current: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      current = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      // 坏档:主进程本来也会回落默认值,这里直接重写。
      current = {};
    }
    if (current.onboardingCompletedAt) return;
  }
  writeFileSync(
    file,
    JSON.stringify(
      {
        theme: 'system',
        language: 'zh-CN',
        ...current,
        onboardingCompletedAt: ONBOARDING_COMPLETED_AT,
      },
      null,
      2,
    ),
    'utf8',
  );
}
