import type { ReactNode } from 'react';
import { IconButton } from '@musefold/ui';
import {
  ChevronRight,
  Command,
  FileText,
  Search,
  Settings,
  Sparkles,
  WandSparkles,
  X,
} from '@musefold/ui/icons';
import pauseMapUrl from '../../../../generated/v31-skill-research/skill-ref-pause-map.jpeg';
import roadUrl from '../../../../generated/v31-skill-research/source-landscape.jpg';

export const DEMO_PROMPT =
  '一张关于慢生活的编辑海报，暖白纸张，细腻印刷颗粒，地图线稿与克制的钴蓝色标题，保留大量留白';

export const DEMO_SESSIONS = ['留白纸感海报', '夜色建筑摄影', '玻璃静物研究', '山间民宿主视觉'];

const demoPrompts = [
  ['留白纸感海报', '暖白纸张、印刷颗粒与克制的单色锚点。', '24 次使用'],
  ['夜色建筑摄影', '湿润街面与安静的人造光。', '11 次使用'],
  ['玻璃静物', '自然窗光下的透明材质研究。', '7 次使用'],
];

const demoHistory = [
  ['今天 14:32', '留白纸感海报', pauseMapUrl],
  ['昨天 20:18', '夜色建筑摄影', roadUrl],
  ['周一 09:45', '玻璃静物研究', pauseMapUrl],
];

export function DemoNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mf-ios-demo-nav-button${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function DemoImage({
  src,
  alt,
  position = 'center',
}: {
  src: string;
  alt: string;
  position?: string;
}) {
  return <img src={src} alt={alt} draggable={false} style={{ objectPosition: position }} />;
}

export function DemoSecondaryView({
  view,
  onBack,
  onUsePrompt,
  onNotice,
}: {
  view: 'prompts' | 'history' | 'settings';
  onBack: () => void;
  onUsePrompt: (prompt: string) => void;
  onNotice: (message: string) => void;
}) {
  const titles = { prompts: '提示词库', history: '历史记录', settings: '账户设置' } as const;

  return (
    <main className="mf-ios-demo-secondary">
      <div className="mf-ios-demo-secondary-header">
        <div>
          <span className="mf-ios-demo-eyebrow">
            Musefold / {view === 'settings' ? 'ACCOUNT' : 'ARCHIVE'}
          </span>
          <h1>{titles[view]}</h1>
        </div>
        <IconButton label="回到生成" className="mf-ios-demo-icon-button" onClick={onBack}>
          <X aria-hidden="true" />
        </IconButton>
      </div>

      {view === 'prompts' ? (
        <div className="mf-ios-demo-list">
          <label className="mf-ios-demo-search-field">
            <Search aria-hidden="true" />
            <input placeholder="搜索提示词" aria-label="搜索提示词" />
            <Command aria-hidden="true" />
          </label>
          {demoPrompts.map(([title, description, usage]) => (
            <article className="mf-ios-demo-list-row" key={title}>
              <span className="mf-ios-demo-list-icon">
                <FileText aria-hidden="true" />
              </span>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <span className="mf-ios-demo-list-meta">{usage}</span>
              <button
                type="button"
                onClick={() =>
                  onUsePrompt(title === '留白纸感海报' ? DEMO_PROMPT : `${title}，${description}`)
                }
              >
                使用
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {view === 'history' ? (
        <div className="mf-ios-demo-history-grid">
          {demoHistory.map(([date, title, image]) => (
            <button
              type="button"
              className="mf-ios-demo-history-card"
              key={date}
              onClick={() => onNotice(`${title} 已打开`)}
            >
              <img src={image} alt="" />
              <span>
                <strong>{title}</strong>
                <small>{date} · 4 张图像</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {view === 'settings' ? (
        <div className="mf-ios-demo-settings-list">
          <DemoSetting label="账户" value="创作者账户" icon={<Settings aria-hidden="true" />} />
          <DemoSetting label="云端空间" value="已连接" icon={<Sparkles aria-hidden="true" />} />
          <DemoSetting
            label="默认生成质量"
            value="精细"
            icon={<WandSparkles aria-hidden="true" />}
          />
          <DemoSetting label="快捷键" value="⌘ N 新设计" icon={<Command aria-hidden="true" />} />
        </div>
      ) : null}
    </main>
  );
}

function DemoSetting({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="mf-ios-demo-setting-row">
      <span className="mf-ios-demo-setting-icon">{icon}</span>
      <span>
        <strong>{label}</strong>
        <small>{value}</small>
      </span>
      <ChevronRight aria-hidden="true" />
    </div>
  );
}
