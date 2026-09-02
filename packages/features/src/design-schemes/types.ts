import type {
  DesignSchemeSummary,
  DesignSchemeRunMode,
  MarketCandidate,
} from '@musefold/contracts';

/** 方案中心两个范围(承旧 surface):我的方案 / 发现(GitHub 市场)。 */
export type SchemeSurface = 'mine' | 'discover';

/** 新建入口类型(承旧 SchemeCreateKind):前四种走工作台 Agent 管线,import 由宿主对话框承接。 */
export type SchemeCreateKind = 'idea' | 'github' | 'history' | 'prompt' | 'import';

/**
 * 历史来源选择结果(HistorySourcePicker 产出):
 * 契约只含可展示地址与提示词文本,不含本地路径;集成层据此组装创建管线入参。
 */
export interface SchemeHistorySourceSelection {
  items: Array<{
    /** 生成历史 job id(契约实体 id)。 */
    jobId: string;
    /** 首资产稳定展示地址(cloud 302 / 桌面 media://)。 */
    assetUrl: string;
    /** 携带提示词时为原始用户文本;否则 null。 */
    prompt: string | null;
  }>;
  /** 进入 Composer 正文的可编辑提取说明。 */
  note: string;
}

/**
 * 方案资产(cover/相册)是 path-free 元数据(contracts design-scheme 域刻意不含路径),
 * 展示地址由宿主注入解析器:桌面 media:// 映射 / 云端签名或重定向 URL。
 * 返回 null 时渲染占位图标。
 */
export type ResolveSchemeAssetUrl = (assetId: string) => string | null;

/**
 * 跨屏/宿主动作接缝:本模块只经 MusefoldGateway 做数据读写;
 * 需要工作台 Composer、宿主文件对话框或创建管线的动作由集成层注入回调。
 * 缺失的回调对应入口禁用并给出理由(V25-UI-SPEC §8-I4:禁用必须解释),不出现死按钮。
 */
export interface DesignSchemesActions {
  /** 试运行/使用:把方案挂载到工作台 Composer(旧 run-store.attach 语义)。 */
  onRunScheme?(scheme: DesignSchemeSummary, mode: DesignSchemeRunMode): void;
  /** 在 Composer 中修改方案(旧 attachModify 语义)。 */
  onModifyScheme?(scheme: DesignSchemeSummary): void;
  /** 新建管线入口(想法/GitHub/提示词):跳工作台由 Agent 编译草稿。 */
  onCreateScheme?(kind: Exclude<SchemeCreateKind, 'import' | 'history'>): void;
  /** 历史来源创建:HistorySourcePicker 确认后携带选择进入创建管线。 */
  onCreateFromHistory?(selection: SchemeHistorySourceSelection): void;
  /** 导入 .musefold.design 分享包:宿主文件对话框 + 包 staging 后走 gateway importPackage。 */
  onImportScheme?(): void;
  /** 市场候选「添加为草稿」:下载快照 → Agent 编译草稿管线。 */
  onInstallMarketCandidate?(candidate: MarketCandidate): void;
}

/** 计算某新建入口的禁用理由;null = 可用。 */
export function createKindDisabledReason(
  kind: SchemeCreateKind,
  actions: DesignSchemesActions,
): string | null {
  const unavailable = '当前环境暂未接入该入口';
  switch (kind) {
    case 'import':
      return actions.onImportScheme ? null : unavailable;
    case 'history':
      return actions.onCreateFromHistory ? null : unavailable;
    default:
      return actions.onCreateScheme ? null : unavailable;
  }
}
