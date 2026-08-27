// 关于页「应用更新」卡的内容层行(自 AboutSection 拆出,纯搬移 + 保持原 testid)。
import { Loader2, RefreshCw } from '../../../components/ui/icons';
import type {
  ContentLayerCheckSnapshot,
  ContentLayerState,
} from '@musefold/desktop-contracts/updater';
import { Button } from '../../../components/ui/button';

/** 内容层检查 status → 人话。未列出的走「未知状态」。 */
const CONTENT_CHECK_STATUS_LABELS: Record<string, string> = {
  trust_anchor_missing: '更新通道未启用',
  manifest_unreachable: '暂时无法获取更新清单',
  manifest_invalid: '更新清单无效',
  installed: '已下载，重启后启用',
  already_installed: '已是最新内容',
  surface_missing: '当前通道暂无桌面内容包',
  not_in_rollout: '尚未轮到此次更新',
  url_not_https: '更新源不安全，已跳过',
  invalid_bundle_version: '内容包版本无效',
  download_failed: '内容包下载失败',
  size_mismatch: '内容包大小校验未通过',
  sha256_mismatch: '内容包校验未通过',
  extract_failed: '内容包解压失败',
  incomplete_bundle: '内容包不完整',
  disk_error: '无法写入本地内容包',
};

/** manifest_invalid 的 reason → 更具体的人话；与 status 映射独立，缺省回退 status 文案。 */
const CONTENT_CHECK_REASON_LABELS: Record<string, string> = {
  invalid_json: '更新清单格式无效',
  trust_anchor_missing: '更新通道未启用',
  invalid_signature: '更新清单签名无效',
  unsupported_schema_version: '更新清单版本不受支持',
  channel_mismatch: '更新清单与当前通道不匹配',
  invalid_manifest: '更新清单字段无效',
  incompatible_shell_version: '当前应用版本不兼容该内容包',
  bundle_version_not_increasing: '已是最新内容',
  bundle_version_rejected: '该内容包先前已被拒绝',
};

export function formatContentCheckLabel(lastCheck: ContentLayerCheckSnapshot | null): string {
  if (!lastCheck) return '尚未检查';
  if (lastCheck.reason) {
    const reasonLabel = CONTENT_CHECK_REASON_LABELS[lastCheck.reason];
    if (reasonLabel) return reasonLabel;
  }
  return CONTENT_CHECK_STATUS_LABELS[lastCheck.status] ?? '未知状态';
}

export function ContentLayerRow({
  state,
  checking,
  onCheck,
}: {
  state: ContentLayerState | null;
  checking: boolean;
  onCheck: () => void;
}) {
  const versionLabel = !state
    ? '未读取'
    : state.activeSource === 'builtin'
      ? '内置'
      : (state.activeBundleVersion ?? '已应用');
  const pendingVersion = state?.pendingVersion ?? null;
  const checkLabel = formatContentCheckLabel(state?.lastCheck ?? null);

  return (
    <div
      className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]"
      data-testid="about-content-layer"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-primary">内容层 · {versionLabel}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">{checkLabel}</p>
        {pendingVersion ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">
            重启后启用 {pendingVersion}
          </p>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onCheck}
        disabled={checking}
        data-testid="about-content-check-action"
      >
        {checking ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        检查内容更新
      </Button>
    </div>
  );
}
