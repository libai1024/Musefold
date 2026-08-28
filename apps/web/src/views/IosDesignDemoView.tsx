import { useEffect, useState, type FormEvent } from 'react';
import { IconButton, MusefoldMark } from '@musefold/ui';
import {
  WORKBENCH_QUALITY_OPTIONS,
  WorkbenchGenerationSettingsPopover,
  WorkbenchRatioPicker,
  workbenchRatioOptions,
} from '@musefold/product-ui';
import {
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Copy,
  Download,
  History,
  LibraryBig,
  MessageSquarePlus,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Sparkles,
  SquarePen,
  Star,
  Sun,
  WandSparkles,
} from '@musefold/ui/icons';
import pauseMapUrl from '../../../../generated/v31-skill-research/skill-ref-pause-map.jpeg';
import roadUrl from '../../../../generated/v31-skill-research/source-landscape.jpg';
import {
  DEMO_PROMPT,
  DEMO_SESSIONS,
  DemoImage,
  DemoNavButton,
  DemoSecondaryView,
} from './IosDesignDemoParts';

type DemoView = 'generate' | 'prompts' | 'history' | 'settings';
type GenerationState = 'ready' | 'generating' | 'complete';
type DemoTheme = 'dark' | 'light';
type DemoQuality = (typeof WORKBENCH_QUALITY_OPTIONS)[number]['id'];

const DEMO_RATIO_OPTIONS = workbenchRatioOptions();
const DEMO_COUNT_OPTIONS = [1, 2, 4, 6] as const;

const DEMO_RESULTS = [
  { src: pauseMapUrl, alt: '留白纸感海报结果一' },
  { src: roadUrl, alt: '荒漠道路摄影结果二' },
  { src: roadUrl, alt: '荒漠道路摄影结果三', position: 'center 38%' },
  { src: pauseMapUrl, alt: '留白纸感海报结果四', position: 'center 72%' },
  { src: roadUrl, alt: '荒漠道路摄影结果五', position: 'center 62%' },
  { src: pauseMapUrl, alt: '留白纸感海报结果六', position: 'center 26%' },
] as const;

export function IosDesignDemoView() {
  const [view, setView] = useState<DemoView>('generate');
  const [theme, setTheme] = useState<DemoTheme>('dark');
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth > 760,
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState('Musefold Studio');
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [submittedPrompt, setSubmittedPrompt] = useState(DEMO_PROMPT);
  const [generationState, setGenerationState] = useState<GenerationState>('complete');
  const [ratio, setRatio] = useState('1:1');
  const [quality, setQuality] = useState<DemoQuality>('medium');
  const [imageCount, setImageCount] = useState(4);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [submittedRatio, setSubmittedRatio] = useState('1:1');
  const [submittedQuality, setSubmittedQuality] = useState<DemoQuality>('medium');
  const [submittedImageCount, setSubmittedImageCount] = useState(4);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    root.dataset.theme = theme;
    return () => {
      if (previousTheme) root.dataset.theme = previousTheme;
      else delete root.dataset.theme;
    };
  }, [theme]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1800);
  };

  const openView = (nextView: DemoView) => {
    setView(nextView);
    setModelOpen(false);
    if (nextView !== 'generate') {
      setNotice('这是布局 Demo，功能页将沿用同一套壳层');
    }
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || generationState === 'generating') return;
    setSubmittedPrompt(nextPrompt);
    setSubmittedRatio(ratio);
    setSubmittedQuality(quality);
    setSubmittedImageCount(imageCount);
    setGenerationState('generating');
    window.setTimeout(() => setGenerationState('complete'), 950);
  };

  const usePrompt = (nextPrompt: string) => {
    setPrompt(nextPrompt);
    setView('generate');
    setNotice('提示词已放入 Composer');
  };

  return (
    <div
      className="mf-ios-demo"
      data-sidebar-open={sidebarOpen}
      data-ui-register="theater"
      data-theme={theme}
    >
      <aside className="mf-ios-demo-sidebar" aria-label="Musefold Demo 导航">
        <div className="mf-ios-demo-sidebar-header">
          <div className="mf-ios-demo-brand">
            <MusefoldMark aria-hidden="true" focusable="false" />
            <span>Musefold</span>
            <small>DEMO</small>
          </div>
          <IconButton
            className="mf-ios-demo-icon-button mf-ios-demo-sidebar-close"
            label="收起侧栏"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeft aria-hidden="true" />
          </IconButton>
        </div>

        <button
          type="button"
          className="mf-ios-demo-new"
          onClick={() => {
            setView('generate');
            setPrompt('');
            setGenerationState('ready');
            setSidebarOpen(false);
          }}
        >
          <SquarePen aria-hidden="true" />
          <span>新设计</span>
          <Command aria-hidden="true" />
          <kbd>N</kbd>
        </button>

        <p className="mf-ios-demo-section-label">功能</p>
        <nav className="mf-ios-demo-nav" aria-label="Demo 功能导航">
          <DemoNavButton
            active={view === 'generate'}
            icon={<MessageSquarePlus aria-hidden="true" />}
            label="生成"
            onClick={() => openView('generate')}
          />
          <DemoNavButton
            active={view === 'prompts'}
            icon={<LibraryBig aria-hidden="true" />}
            label="提示词库"
            onClick={() => openView('prompts')}
          />
          <DemoNavButton
            active={view === 'history'}
            icon={<History aria-hidden="true" />}
            label="历史记录"
            onClick={() => openView('history')}
          />
        </nav>

        <div className="mf-ios-demo-sessions">
          <div className="mf-ios-demo-sessions-heading">
            <span>最近会话</span>
            <ChevronDown aria-hidden="true" />
          </div>
          <div className="mf-ios-demo-session-list">
            {DEMO_SESSIONS.map((session, index) => (
              <button
                type="button"
                className={`mf-ios-demo-session${index === 0 ? ' is-active' : ''}`}
                key={session}
                onClick={() => {
                  setView('generate');
                  setSubmittedPrompt(index === 0 ? DEMO_PROMPT : `${session}的视觉方向`);
                  setSidebarOpen(false);
                }}
              >
                <span>{session}</span>
                {index === 0 ? <span className="mf-ios-demo-unread" /> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="mf-ios-demo-sidebar-footer">
          <button
            type="button"
            className={`mf-ios-demo-account${view === 'settings' ? ' is-active' : ''}`}
            onClick={() => openView('settings')}
          >
            <span className="mf-ios-demo-avatar">W</span>
            <span>
              <strong>创作者账户</strong>
              <small>1,280 积分</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="mf-ios-demo-main">
        <header className="mf-ios-demo-topbar">
          <div className="mf-ios-demo-topbar-leading">
            <IconButton
              className="mf-ios-demo-icon-button mf-ios-demo-menu-button"
              label="展开侧栏"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft aria-hidden="true" />
            </IconButton>
            <div className="mf-ios-demo-topbar-title">
              <span>工作台</span>
              {view === 'generate' ? (
                <button
                  type="button"
                  className="mf-ios-demo-model-trigger"
                  aria-expanded={modelOpen}
                  onClick={() => setModelOpen((current) => !current)}
                >
                  <Sparkles aria-hidden="true" />
                  <strong>{model}</strong>
                  <ChevronDown aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="mf-ios-demo-topbar-actions">
            <IconButton
              className="mf-ios-demo-icon-button"
              label="搜索"
              onClick={() => showNotice('搜索入口已预留')}
            >
              <Search aria-hidden="true" />
            </IconButton>
            <IconButton
              className="mf-ios-demo-icon-button mf-ios-demo-theme-toggle"
              label={theme === 'dark' ? '切换为亮色' : '切换为暗色'}
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </IconButton>
            <span className="mf-ios-demo-quota">
              <Sparkles aria-hidden="true" />
              1,280
            </span>
          </div>
          {modelOpen ? (
            <div className="mf-ios-demo-model-menu" role="menu" aria-label="生成模型">
              {['Musefold Studio', '快速生成', '细节优先'].map((option) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={model === option}
                  key={option}
                  onClick={() => {
                    setModel(option);
                    setModelOpen(false);
                  }}
                >
                  <span>
                    <strong>{option}</strong>
                    <small>
                      {option === 'Musefold Studio' ? '平衡速度与画面质感' : 'Demo 选项'}
                    </small>
                  </span>
                  {model === option ? <Check aria-hidden="true" /> : null}
                </button>
              ))}
              <div className="mf-ios-demo-model-menu-divider" />
              <button type="button" onClick={() => setModelOpen(false)}>
                <span>
                  <strong>思考等级</strong>
                  <small>标准</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </header>

        {view === 'generate' ? (
          <GenerateDemoContent
            generationState={generationState}
            prompt={prompt}
            submittedPrompt={submittedPrompt}
            ratio={ratio}
            quality={quality}
            imageCount={imageCount}
            submittedRatio={submittedRatio}
            submittedQuality={submittedQuality}
            submittedImageCount={submittedImageCount}
            negativePrompt={negativePrompt}
            onPromptChange={setPrompt}
            onSubmit={submitPrompt}
            onSelectImageCount={setImageCount}
            onSelectRatio={setRatio}
            onSelectQuality={(value) => setQuality(value as DemoQuality)}
            onNegativePromptChange={setNegativePrompt}
            onNotice={showNotice}
          />
        ) : (
          <DemoSecondaryView
            view={view}
            onBack={() => openView('generate')}
            onUsePrompt={usePrompt}
            onNotice={showNotice}
          />
        )}
      </div>

      {notice ? (
        <div className="mf-ios-demo-notice" role="status">
          {notice}
        </div>
      ) : null}
      {sidebarOpen ? (
        <button
          type="button"
          className="mf-ios-demo-scrim"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
    </div>
  );
}

function GenerateDemoContent({
  generationState,
  prompt,
  submittedPrompt,
  ratio,
  quality,
  imageCount,
  submittedRatio,
  submittedQuality,
  submittedImageCount,
  negativePrompt,
  onPromptChange,
  onSubmit,
  onSelectImageCount,
  onSelectRatio,
  onSelectQuality,
  onNegativePromptChange,
  onNotice,
}: {
  generationState: GenerationState;
  prompt: string;
  submittedPrompt: string;
  ratio: string;
  quality: DemoQuality;
  imageCount: number;
  submittedRatio: string;
  submittedQuality: DemoQuality;
  submittedImageCount: number;
  negativePrompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSelectImageCount: (value: number) => void;
  onSelectRatio: (value: string) => void;
  onSelectQuality: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onNotice: (message: string) => void;
}) {
  const qualityLabel =
    WORKBENCH_QUALITY_OPTIONS.find((option) => option.id === submittedQuality)?.label ??
    submittedQuality;

  return (
    <main className="mf-ios-demo-workspace">
      <div className="mf-ios-demo-scroll">
        <div className="mf-ios-demo-content-column">
          <div className="mf-ios-demo-heading-row">
            <div>
              <span className="mf-ios-demo-eyebrow">视觉工作台 / 01</span>
              <h1>把想法变成画面</h1>
            </div>
            <span className="mf-ios-demo-save-state">
              <span />
              {generationState === 'generating' ? '生成中' : '已保存'}
            </span>
          </div>

          <section className="mf-ios-demo-job" aria-label="生成结果">
            <div className="mf-ios-demo-job-header">
              <div className="mf-ios-demo-job-identity">
                <span className="mf-ios-demo-mark">
                  <MusefoldMark aria-hidden="true" />
                </span>
                <span>
                  <strong>Musefold</strong>
                  <small>
                    {generationState === 'generating' ? '正在生成新的画面' : '刚刚生成'}
                  </small>
                </span>
              </div>
              <span className="mf-ios-demo-job-meta">
                {submittedRatio} · {qualityLabel} · {submittedImageCount} 张
              </span>
            </div>
            <p className="mf-ios-demo-job-prompt">{submittedPrompt}</p>
            <div
              className={`mf-ios-demo-image-grid${generationState === 'generating' ? ' is-generating' : ''}`}
              data-count={submittedImageCount}
            >
              {DEMO_RESULTS.slice(0, submittedImageCount).map((image) => (
                <DemoImage key={image.alt} {...image} />
              ))}
              {generationState === 'generating' ? (
                <div className="mf-ios-demo-image-progress" role="status">
                  <WandSparkles aria-hidden="true" />
                  <span>正在生成 · 68%</span>
                </div>
              ) : null}
            </div>
            <div className="mf-ios-demo-job-footer">
              <div className="mf-ios-demo-job-actions">
                <IconButton
                  label="收藏"
                  className="mf-ios-demo-inline-icon"
                  onClick={() => onNotice('已收藏结果')}
                >
                  <Star aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="保存到提示词库"
                  className="mf-ios-demo-inline-icon"
                  onClick={() => onNotice('已保存到提示词库')}
                >
                  <Bookmark aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="下载图片"
                  className="mf-ios-demo-inline-icon"
                  onClick={() => onNotice('下载入口已触发')}
                >
                  <Download aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="复制提示词"
                  className="mf-ios-demo-inline-icon"
                  onClick={() => onNotice('提示词已复制')}
                >
                  <Copy aria-hidden="true" />
                </IconButton>
              </div>
              <span className="mf-ios-demo-result-label">图像生成结果</span>
            </div>
          </section>
        </div>
      </div>

      <div className="mf-ios-demo-composer-dock">
        <form className="mf-ios-demo-composer" onSubmit={onSubmit}>
          <div className="mf-ios-demo-composer-topline">
            <span className="mf-ios-demo-composer-context">
              <span />
              图像创作
            </span>
            <span className="mf-ios-demo-composer-hint">Enter 生成 · Shift + Enter 换行</span>
          </div>
          <div className="mf-ios-demo-composer-body">
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              aria-label="图像提示词"
              placeholder="描述你想要的画面..."
              rows={2}
            />
          </div>
          <div className="mf-ios-demo-composer-toolbar">
            <div className="mf-ios-demo-composer-tools" aria-label="生成参数">
              <button
                type="button"
                className="mf-ios-demo-add-button"
                aria-label="添加参考"
                title="添加参考"
                onClick={() => onNotice('参考图入口已预留')}
              >
                <Plus aria-hidden="true" />
              </button>
              <WorkbenchRatioPicker
                value={ratio}
                options={DEMO_RATIO_OPTIONS}
                onChange={onSelectRatio}
                testIdPrefix="demo-ratio"
                allowCustomRatio
              />
              <WorkbenchGenerationSettingsPopover
                quality={quality}
                qualityOptions={WORKBENCH_QUALITY_OPTIONS}
                count={imageCount}
                countOptions={DEMO_COUNT_OPTIONS}
                negative={negativePrompt}
                onQualityChange={onSelectQuality}
                onCountChange={onSelectImageCount}
                onNegativeChange={onNegativePromptChange}
                testId="demo-generation-settings"
              />
            </div>
            <button
              type="submit"
              className="mf-ios-demo-submit"
              disabled={!prompt.trim() || generationState === 'generating'}
              aria-label={generationState === 'generating' ? '正在生成' : '生成图片'}
              title={generationState === 'generating' ? '正在生成' : '生成图片'}
            >
              {generationState === 'generating' ? (
                <span className="mf-ios-demo-spinner" />
              ) : (
                <ArrowUp aria-hidden="true" />
              )}
            </button>
          </div>
        </form>
        <p className="mf-ios-demo-composer-footnote">生成前不会扣除积分 · Musefold Cloud</p>
      </div>
    </main>
  );
}
