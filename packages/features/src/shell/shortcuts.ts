/**
 * 产品快捷键单源(00-codex-craft §5.4 C-2,07-settings-07 §2.4/§5.2)。
 *
 * 硬规则:**只登记真实接线的条目** —— kbd 提示与实际未绑定即撒谎(00 法则 6)。
 * 新接快捷键的流程:先接线,再在此登记 `wiredAt`(代码坐标),最后让 UI 消费;
 * 菜单右列 / tooltip / 设置快捷键表(07-07 P2)一律从这里取数,禁止手写平行表。
 * (文档 07-07 写的旧版数据源在 domain 包;v2.5 边界规则禁止 features 依赖 domain,
 * 快捷键目录属产品语义,归 features shell。)
 */
export interface ProductShortcut {
  id:
    | 'new-session'
    | 'composer-send'
    | 'composer-newline'
    | 'prompts-search'
    | 'prompts-focus-search'
    | 'prompt-editor-save'
    | 'dismiss';
  /** macOS 显示串(⌘ 系) */
  mac: string;
  /** Windows/Linux 显示串(Ctrl 系) */
  win: string;
  /** 人话描述(快捷键表左列) */
  label: string;
  /** 生效作用域;Enter 系必须标注,避免「全工作区可用」误导(07-07 §2.4) */
  scope: string;
  /** 接线位置(代码坐标,评审对账用) */
  wiredAt: string;
}

export const PRODUCT_SHORTCUTS: readonly ProductShortcut[] = [
  {
    id: 'new-session',
    mac: '⌘N',
    win: 'Ctrl+N',
    label: '新设计',
    scope: '全局(浏览器可能保留 ⌘N)',
    wiredAt: 'workbench/SessionListPanel NewSessionAction keydown',
  },
  {
    id: 'composer-send',
    mac: 'Enter',
    win: 'Enter',
    label: '发送生成',
    scope: '聚焦工作台输入框',
    wiredAt: 'workbench/Composer Textarea onKeyDown',
  },
  {
    id: 'composer-newline',
    mac: 'Shift+Enter',
    win: 'Shift+Enter',
    label: '换行',
    scope: '聚焦工作台输入框',
    wiredAt: 'workbench/Composer Textarea onKeyDown',
  },
  {
    id: 'prompts-search',
    mac: '⌘K',
    win: 'Ctrl+K',
    label: '搜索提示词',
    scope: '全局(切到提示词库并聚焦搜索框)',
    wiredAt: 'shell/AppShell ⌘K keydown → screen-intent prompts-focus-search',
  },
  {
    id: 'prompts-focus-search',
    mac: '/',
    win: '/',
    label: '聚焦搜索框',
    scope: '提示词库(非输入态)',
    wiredAt: 'prompts/PromptLibraryScreen 非输入态 "/" keydown',
  },
  {
    id: 'prompt-editor-save',
    mac: '⌘S',
    win: 'Ctrl+S',
    label: '保存提示词',
    scope: '提示词编辑器(有未保存修改时)',
    wiredAt: 'prompts/PromptEditorDialog DialogContent onKeyDown',
  },
  {
    id: 'dismiss',
    mac: 'Esc',
    win: 'Esc',
    label: '关闭浮层 / 取消行内编辑',
    scope: '浮层与行内编辑',
    wiredAt: 'Radix Dialog/Menu 内建 + SessionListPanel/HistoryRow 行内编辑 onKeyDown',
  },
] as const;

/** 按平台取显示串;调用方决定 isMac(SSR 首帧不可知时挂载后再显示,防 hydration 闪)。 */
export function shortcutDisplay(id: ProductShortcut['id'], isMac: boolean): string {
  const shortcut = PRODUCT_SHORTCUTS.find((item) => item.id === id);
  if (!shortcut) return '';
  return isMac ? shortcut.mac : shortcut.win;
}

/** 平台探测(仅浏览器环境;SSR 返回 false,调用方在 effect 里用)。 */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}
