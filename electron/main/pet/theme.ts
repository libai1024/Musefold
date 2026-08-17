// electron/main/pet/theme.ts
// 桌宠主题加载：读 theme.json，拍平分组，规范化成状态机能直接查的表。

import { readFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import type { PetStateDef, PetTheme, PetThemeManifest } from '@shared/types/pet';

const DEFAULT_THEME = 'cat';

/** 主题目录。dev 走仓库内 resources/，打包后走 extraResources 落点。 */
export function resolveThemeDir(
  name: string = DEFAULT_THEME,
  environment: { packaged: boolean; appPath: string; resourcesPath: string } = {
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  },
): string {
  // 主题名只允许小写字母数字连字符，挡掉 ../ 之类的路径穿越
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('PET_THEME_FORBIDDEN: 非法主题名');
  return environment.packaged
    ? join(environment.resourcesPath, 'pet', name)
    : join(environment.appPath, 'resources', 'pet', name);
}

/**
 * 把 manifest 的分组拍平成一张 canonical 状态表。
 *
 * 顺带修两处上游主题的定义问题，让状态机不必为脏数据写特例：
 *  1. mini 组的键是裸名（idle / alert），但 mini-enter 的 to 指向 "mini-idle"，
 *     所以拍平时统一补 mini- 前缀。
 *  2. idleEggs 里混了 A 类状态（idle-living）。A 类没有 returnTo，插播后会
 *     永久停在彩蛋上再也回不到 idle，这里强制降级成 B 类。
 */
function flatten(manifest: PetThemeManifest): Record<string, PetStateDef> {
  const out: Record<string, PetStateDef> = {};

  const absorb = (group: Record<string, PetStateDef | string> | undefined, prefix = ''): void => {
    if (!group) return;
    for (const [key, def] of Object.entries(group)) {
      // mini 组里混了 _mirror_hint 之类的字符串注释字段
      if (typeof def !== 'object' || def === null) continue;
      const name = prefix && !key.startsWith(prefix) ? `${prefix}${key}` : key;
      out[name] = def;
    }
  };

  absorb(manifest.states);
  absorb(manifest.transitions);
  absorb(manifest.reactions);
  absorb(manifest.mini, 'mini-');

  for (const egg of manifest.idleEggs ?? []) {
    const def = out[egg];
    if (def && def.type === 'A') {
      out[egg] = { ...def, type: 'B', returnTo: 'idle', durMs: def.durMs ?? 6000 };
    }
  }

  return out;
}

export interface LoadedTheme {
  theme: PetTheme;
  dir: string;
}

/** 加载主题。读不到或格式不对时抛错，由调用方决定是否降级关掉桌宠。 */
export function loadTheme(name: string = DEFAULT_THEME): LoadedTheme {
  const dir = resolveThemeDir(name);
  const manifest = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf-8')) as PetThemeManifest;
  const states = flatten(manifest);
  if (!states.idle) throw new Error('PET_THEME_INVALID: 主题缺少 idle 状态');

  return {
    dir,
    theme: {
      name: manifest.name,
      displayName: manifest.displayName,
      states,
      idleEggs: (manifest.idleEggs ?? []).filter((egg) => Boolean(states[egg])),
      canvas: manifest.meta?.canvas ?? { w: 300, h: 300 },
    },
  };
}
