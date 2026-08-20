// packages/desktop-contracts/src/ipc/automation.ts
// automation 域：控制面类型 + Api namespace（V13-GOV-04 自 ipc.ts 分域拆出）。

import type { ProviderType } from "../enums";

/** 控制面状态（设置页「自动化」面板；token 仅在本机 UI 展示，用于接入配置） */
export interface AutomationStatus {
  enabled: boolean;
  running: boolean;
  port: number | null;
  token: string | null;
  apiVersion: "v1";
  discoveryPath: string | null;
}

/** 端点级请求日志条目（NDJSON 骨架，内部诊断用） */
export interface AutomationAuditEntry {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  errorCode?: string;
}

/** 花钱动作审计（SEC-01 完整落库；Q5：提示词全文仅本机，列表 UI 截断展示） */
export interface AutomationSpendAudit {
  id: number;
  at: number;
  action: "generate_image" | "run_scheme" | "run_github_skill";
  promptText: string | null;
  approvedVia:
    | "budget"
    | "confirmation"
    | "consent"
    | "idempotent-replay"
    | "denied"
    | "timeout";
  status: "success" | "failed" | "cancelled" | "denied" | "timeout";
  estimatedPoints: number | null;
  actualPoints: number | null;
  jobId: string | null;
}

/** 花钱动作确认卡（策略闸门分支 c，V04-ARCHITECTURE §5.4） */
export interface AutomationConfirmationSummary {
  confirmationId: string;
  providerName: string;
  model: string;
  n: number;
  estimatedPoints: number | null;
  promptPreview: string;
}

/** 自动化预算（Q1 拍板：默认 0，一切花钱须确认） */
export interface AutomationBudget {
  monthlyLimitPoints: number;
  usedPoints: number;
  month: string;
}

export interface AutomationProviderDraft {
  name?: string;
  type?: ProviderType;
  baseUrl?: string;
  model?: string;
}

/** 主进程通知渲染层打开原生安全配置表单；永不包含密钥或账号凭据。 */
export interface AutomationSetupRequest {
  requestId: string;
  kind: "account" | "provider";
  mode?: "login" | "register";
  draft?: AutomationProviderDraft;
}

/** 客户端接入信息（设置 → 自动化 → 接入向导；私下分发零依赖方案） */
export interface IntegrationInfo {
  /** 内置 MCP/CLI 产物是否就位（开发态需先 node scripts/build-cli.mjs） */
  bundledReady: boolean;
  /** MCP 服务器启动规格（配置里不含任何密钥，发现链自读 automation.json） */
  launch: { command: string; args: string[]; env: Record<string, string> };
  snippets: {
    cursorJson: string;
    cursorDeeplink: string;
    claudeCommand: string;
    codexToml: string;
    /** 公开 Skill 地址，用户可直接粘贴给能够读取网页的 Agent。 */
    skillUrl: string;
    /** 兼容旧版地安装动作的 Skill 正文；设置页不再直接展示。 */
    skillMarkdown: string;
  };
  skills: {
    targets: Record<"claude" | "codex" | "cursor", string>;
    installed: Record<"claude" | "codex" | "cursor", boolean>;
    installedVersions: Record<"claude" | "codex" | "cursor", string | null>;
    bundledVersion: string;
    availableVersion: string;
    updateAvailable: boolean;
    checkedAt: string | null;
    checkError: string | null;
    autoUpdate: boolean;
  };
  clients: {
    cursor: { configPath: string; registered: boolean };
    claudeCode: { cliDetected: boolean; registered: boolean };
    codex: { configPath: string; configExists: boolean; registered: boolean };
  };
  cli: {
    installed: boolean;
    upToDate: boolean;
    /** shim 所在目录是否出现在当前进程或 Windows 用户 PATH 中。 */
    onPath: boolean;
    path: string | null;
    installDirs: string[];
  };
}

export type IntegrationAction =
  | "install-cli"
  | "uninstall-cli"
  | "open-skill-url"
  | "open-cursor-deeplink"
  | "register-claude-code"
  | "check-skill-update"
  | "enable-skill-auto-update"
  | "disable-skill-auto-update"
  | "install-skill-claude"
  | "install-skill-codex"
  | "install-skill-cursor"
  | "install-skill-all";

export interface IntegrationActionResult {
  ok: boolean;
  message: string;
}

export interface AutomationApi {
  status: () => Promise<AutomationStatus>;
  setEnabled: (enabled: boolean) => Promise<AutomationStatus>;
  rotateToken: () => Promise<AutomationStatus>;
  auditList: (limit?: number) => Promise<AutomationSpendAudit[]>;
  /** App 确认卡回执（策略闸门分支 c） */
  confirm: (confirmationId: string, approved: boolean) => Promise<{ ok: boolean }>;
  budget: {
    get: () => Promise<AutomationBudget>;
    set: (monthlyLimitPoints: number) => Promise<AutomationBudget>;
  };
  onConfirmationRequired: (
    cb: (summary: AutomationConfirmationSummary) => void,
  ) => () => void;
  onConfirmationResolved: (
    cb: (payload: {
      confirmationId: string;
      outcome: "approved" | "denied" | "timeout";
    }) => void,
  ) => () => void;
  /** 外部任务活动流（朱点忙碌态，SET-02）：jobId + running 快照 */
  onActivity: (
    cb: (payload: { jobId: string; running: boolean }) => void,
  ) => () => void;
  onSetupRequested: (cb: (request: AutomationSetupRequest) => void) => () => void;
  onProviderChanged: (
    cb: (payload: { providerId: string }) => void,
  ) => () => void;
  /** 客户端接入向导（Cursor / ChatGPT 桌面 / Claude Code / CLI） */
  integrationInfo: () => Promise<IntegrationInfo>;
  integrationAction: (action: IntegrationAction) => Promise<IntegrationActionResult>;
}
