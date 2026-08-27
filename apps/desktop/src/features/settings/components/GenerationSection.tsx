// 制作工作台的单一默认参数集。
// 提交时的回合快照优先级最高；历史重试永远不会被这里的默认值覆盖。
// 服务商的切换收敛在侧栏底部的模型切换器，这里只管生成参数本身。
import type { ImageBackground, ImageQuality } from '@musefold/desktop-contracts/enums';
import type { SchemePriorityMode } from '@musefold/desktop-contracts/design-scheme';
import {
  describePriorityMode,
  PRIORITY_MODE_LABEL,
} from '@musefold/desktop-contracts/design-scheme/prompt-compiler';
import { useAppStore } from '../../../stores/app';
import { useGenerationWorkbenchStore } from '@renderer/runtime/workbench-access';
import { SettingRow, SettingsCard } from '../components/SectionShell';
import { ChoiceChips } from '../components/ChoiceChips';
import { RatioPicker } from '@renderer/runtime/generation-access';

const QUALITIES: { value: ImageQuality; label: string }[] = [
  { value: 'low', label: '标准' },
  { value: 'medium', label: '高清' },
  { value: 'high', label: '超清' },
];
const COUNTS = [1, 2, 4, 6];
const BACKGROUNDS: { value: ImageBackground; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'transparent', label: '透明' },
  { value: 'opaque', label: '不透明' },
];
// 设计规范 §4.1：三档运行优先级，默认「方案主导」；顺序与文档表格一致。
const PRIORITY_MODES: SchemePriorityMode[] = ['user_first', 'scheme_first', 'agent_mediated'];

export function GenerationSection() {
  const schemePriorityMode = useAppStore((s) => s.schemePriorityMode);
  const setSchemePriorityMode = useAppStore((s) => s.setSchemePriorityMode);
  const params = useGenerationWorkbenchStore((s) => s.params);
  const setParams = useGenerationWorkbenchStore((s) => s.setParams);

  return (
    <>
      <SettingsCard title="生成参数" description="设置新设计默认使用的画幅、质量、背景和生成数量；修改会同步应用到当前工作台草稿。">
        <SettingRow label="默认比例" hint="与工作台一致的画幅下拉">
          <RatioPicker
            value={params.ratioId}
            onChange={(ratioId) => setParams({ ratioId })}
            testIdPrefix="settings-default-ratio"
            side="bottom"
            align="end"
          />
        </SettingRow>

        <SettingRow label="默认质量" hint="质量越高，耗时和成本越高">
          <ChoiceChips
            value={params.quality}
            options={QUALITIES}
            onChange={(quality) => setParams({ quality })}
          />
        </SettingRow>

        <SettingRow label="默认背景" hint="透明背景需上游模型支持">
          <ChoiceChips
            value={params.background ?? 'auto'}
            options={BACKGROUNDS}
            onChange={(background) => setParams({ background })}
            testIdPrefix="settings-default-background"
          />
        </SettingRow>

        <SettingRow label="默认数量" hint="自由创作与方案运行都可在提交前调整">
          <ChoiceChips
            value={params.n}
            options={COUNTS.map((count) => ({ value: count, label: `${count} 张` }))}
            onChange={(n) => setParams({ n })}
            testIdPrefix="settings-default-count"
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard
        title="方案运行"
        description="控制方案、用户输入与 Agent 调解之间的默认优先关系"
      >
        <SettingRow
          label="方案运行优先级"
          hint={
            schemePriorityMode === 'agent_mediated' ? (
              <>
                {describePriorityMode(schemePriorityMode)}
                <span className="block">
                  调用文本模型自动取舍，会产生额外的文本模型消耗
                </span>
              </>
            ) : (
              describePriorityMode(schemePriorityMode)
            )
          }
        >
          <ChoiceChips
            value={schemePriorityMode}
            options={PRIORITY_MODES.map((mode) => ({
              value: mode,
              label: PRIORITY_MODE_LABEL[mode],
            }))}
            onChange={(mode) => setSchemePriorityMode(mode)}
            testIdPrefix="settings-scheme-priority"
          />
        </SettingRow>
      </SettingsCard>
    </>
  );
}
