/** 设置分组 id(导航分组顺序的叶子类型,不含分区注册表)。 */
export type SettingsGroupId = 'general' | 'access' | 'app';

/** 设置分区 id(深链 / 记忆 / 导航共用的叶子类型,不含分区注册表)。 */
export type SettingsSectionId =
  | 'appearance'
  | 'account'
  | 'sync'
  | 'connections'
  | 'data'
  | 'open'
  | 'usage'
  | 'about';
