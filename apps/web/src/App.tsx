import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  Check,
  CircleUserRound,
  Copy,
  FileText,
  Library,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  MessageSquareText,
  PanelLeft,
  Search,
  Sparkles,
  Square,
  SquarePen,
  SlidersHorizontal,
  WandSparkles,
} from 'lucide-react';
import {
  cloudGenerationRequestSchema,
  type AccountSession,
  type GenerationJob,
  type GenerationQuality,
  type PromptDocument,
  type PromptPage,
} from '@musefold/contracts';
import {
  applyPromptToGeneration,
  canCancelGeneration,
  getProductCapabilities,
  isGenerationTerminal,
} from '@musefold/domain';
import musefoldIconUrl from '../../../website/Musefold/assets/musefold-icon.png';
import musefoldLogoUrl from '../../../docs/v0.3/logo.png';
import { WebGatewayError, type WebGateway } from './runtime';

type View = 'generate' | 'prompts' | 'account';
type Ratio = '1:1' | '16:9' | '9:16';

const capabilities = getProductCapabilities('web');

const ratioSizes: Record<Ratio, '1024x1024' | '1536x1024' | '1024x1536'> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
};

interface AppProps {
  gateway: WebGateway;
}

export function App({ gateway }: AppProps) {
  const [view, setView] = useState<View>('generate');
  const [session, setSession] = useState<AccountSession | null>(null);
  const [prompts, setPrompts] = useState<PromptPage>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [ratio, setRatio] = useState<Ratio>('1:1');
  const [quality, setQuality] = useState<GenerationQuality>('medium');
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadWorkspace = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextSession, nextPrompts] = await Promise.all([
        gateway.getSession(),
        gateway.listPrompts({ limit: 20 }),
      ]);
      setSession(nextSession);
      setPrompts(nextPrompts);
      setAuthRequired(false);
    } catch (error) {
      if (error instanceof WebGatewayError && ['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(error.code)) {
        setAuthRequired(true);
      } else {
        setLoadError(error instanceof Error ? error.message : '无法载入 Musefold');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, [gateway]);

  useEffect(() => {
    if (!job || isGenerationTerminal(job.status)) return;
    const timer = window.setTimeout(() => {
      gateway.getGeneration(job.id)
        .then(setJob)
        .catch((error) => setActionError(error instanceof Error ? error.message : '任务状态更新失败'));
    }, 520);
    return () => window.clearTimeout(timer);
  }, [gateway, job]);

  const selectPrompt = (prompt: PromptDocument) => {
    const request = applyPromptToGeneration(prompt, { quality, aspectRatio: ratio });
    setPromptText(request.prompt);
    setSelectedPromptId(prompt.id);
    setView('generate');
    setActionError(null);
  };

  const submitGeneration = async () => {
    if (!session?.account.canGenerate || !capabilities.generation) return;
    setActionError(null);
    try {
      const request = cloudGenerationRequestSchema.parse({
        prompt: promptText,
        promptId: selectedPromptId ?? undefined,
        size: ratioSizes[ratio],
        aspectRatio: ratio,
        quality,
        count: 1,
      });
      setJob(await gateway.createGeneration(request, crypto.randomUUID()));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法创建生成任务');
    }
  };

  const cancelGeneration = async () => {
    if (!job || !canCancelGeneration(job)) return;
    setActionError(null);
    try {
      setJob(await gateway.cancelGeneration(job.id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法取消任务');
    }
  };

  if (loading) return <LoadingScreen />;
  if (authRequired) {
    return <LoginScreen gateway={gateway} onAuthenticated={() => void loadWorkspace()} />;
  }
  if (loadError || !session) {
    return <FailureScreen message={loadError ?? '会话不可用'} onRetry={() => void loadWorkspace()} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        accountName={session.account.displayName ?? session.account.username}
        mode={gateway.mode}
        onNavigate={setView}
      />
      <main className="app-main">
        <Topbar
          view={view}
          quota={`${session.account.quota} ${session.account.quotaUnit}`}
          mode={gateway.mode}
        />
        {view === 'generate' && (
          <GenerateView
            promptText={promptText}
            ratio={ratio}
            quality={quality}
            job={job}
            error={actionError}
            canGenerate={session.account.canGenerate}
            onPromptTextChange={setPromptText}
            onRatioChange={setRatio}
            onQualityChange={setQuality}
            onSubmit={() => void submitGeneration()}
            onCancel={() => void cancelGeneration()}
          />
        )}
        {view === 'prompts' && (
          <PromptLibraryView prompts={prompts.items} onUse={selectPrompt} />
        )}
        {view === 'account' && (
          <AccountView
            session={session}
            mode={gateway.mode}
            onLogout={async () => {
              await gateway.logout();
              setSession(null);
              setAuthRequired(true);
            }}
          />
        )}
      </main>
      <MobileNavigation view={view} onNavigate={setView} />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="center-screen" role="status" aria-live="polite">
      <img className="loading-mark" src={musefoldIconUrl} alt="" />
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>正在载入</span>
    </div>
  );
}

function FailureScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="center-screen">
      <img className="loading-mark" src={musefoldIconUrl} alt="Musefold" />
      <strong>暂时无法连接</strong>
      <span>{message}</span>
      <button className="button button-primary" type="button" onClick={onRetry}>重试</button>
    </div>
  );
}

function LoginScreen({ gateway, onAuthenticated }: { gateway: WebGateway; onAuthenticated: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await gateway.login({ username, password });
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-screen">
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <div className="brand-lockup brand-lockup-login">
          <img src={musefoldIconUrl} alt="" />
          <div><strong>Musefold</strong><span>未像</span></div>
        </div>
        <h1>登录个人账户</h1>
        <label>
          <span>账号</span>
          <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          <span>密码</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary login-submit" type="submit" disabled={submitting || !username || !password}>
          {submitting ? <LoaderCircle className="spin" aria-hidden="true" /> : <CircleUserRound aria-hidden="true" />}
          登录
        </button>
      </form>
    </main>
  );
}

function Sidebar({
  view,
  accountName,
  mode,
  onNavigate,
}: {
  view: View;
  accountName: string;
  mode: WebGateway['mode'];
  onNavigate: (view: View) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-titlebar">
        <button className="icon-button sidebar-collapse" type="button" aria-label="收起侧栏" title="收起侧栏">
          <PanelLeft aria-hidden="true" />
        </button>
      </div>
      <div className="sidebar-new">
        <button className="nav-button nav-new" type="button" onClick={() => onNavigate('generate')}>
          <SquarePen aria-hidden="true" /><span>新设计</span><kbd>⌘N</kbd>
        </button>
      </div>
      <p className="sidebar-section-label">工作区</p>
      <nav className="sidebar-nav" aria-label="主导航">
        <NavButton active={view === 'generate'} icon={<WandSparkles />} label="制作工作台" onClick={() => onNavigate('generate')} />
        <NavButton active={view === 'prompts'} icon={<Library />} label="提示词库" count={3} onClick={() => onNavigate('prompts')} />
      </nav>
      <button className="sidebar-account" type="button" onClick={() => onNavigate('account')}>
        <span className="account-avatar">{accountName.slice(0, 1)}</span>
        <span><strong>{accountName}</strong><small>{mode === 'fixture' ? '开发数据' : '个人账户'}</small></span>
      </button>
    </aside>
  );
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button className="nav-button" data-active={active} type="button" onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}<span>{label}</span>{count ? <small>{count}</small> : null}
    </button>
  );
}

function Topbar({ view, quota, mode }: { view: View; quota: string; mode: WebGateway['mode'] }) {
  const titles: Record<View, string> = { generate: '新设计', prompts: '提示词库', account: '账户' };
  const icons: Record<View, React.ReactNode> = {
    generate: <MessageSquareText aria-hidden="true" />,
    prompts: <MessageSquareText aria-hidden="true" />,
    account: <MessageSquareText aria-hidden="true" />,
  };
  return (
    <header className="topbar">
      <div>
        <span className="topbar-view-icon">{icons[view]}</span>
        <h1>{titles[view]}</h1>
        {mode === 'fixture' && <span className="status-chip">开发预览</span>}
      </div>
      <div className="topbar-actions">
        <button className="icon-button" type="button" title="搜索" aria-label="搜索">
          <Search aria-hidden="true" />
        </button>
        <div className="quota-readout" aria-label={`可用额度 ${quota}`}>
          <Sparkles aria-hidden="true" /><span>{quota}</span>
        </div>
        <button className="icon-button" type="button" title="更多" aria-label="更多">
          <MoreHorizontal aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function GenerateView({
  promptText,
  ratio,
  quality,
  job,
  error,
  canGenerate,
  onPromptTextChange,
  onRatioChange,
  onQualityChange,
  onSubmit,
  onCancel,
}: {
  promptText: string;
  ratio: Ratio;
  quality: GenerationQuality;
  job: GenerationJob | null;
  error: string | null;
  canGenerate: boolean;
  onPromptTextChange: (value: string) => void;
  onRatioChange: (value: Ratio) => void;
  onQualityChange: (value: GenerationQuality) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const active = job && !isGenerationTerminal(job.status);
  const result = job?.assets[0];
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <section className="workbench-page" data-testid="generation-workbench">
      <div className="workbench-scroll">
        {job ? (
          <article className="generation-turn" data-state={job.status}>
            <div className="turn-prompt">{promptText || '未命名设计'}</div>
            <div className="turn-result">
              <span className="assistant-mark"><img src={musefoldIconUrl} alt="" /></span>
              <div className="turn-result-body">
                <div className="turn-result-heading"><strong>Musefold</strong><span>{job.status === 'succeeded' ? '生成完成' : job.status === 'cancelled' ? '已取消' : job.status === 'queued' ? '排队中' : '生成中'}</span></div>
                {result ? (
                  <div className="generated-asset" data-ratio={ratio}>
                    <img src={result.url} alt="生成结果" />
                    <a className="result-download" href={result.url} download title="下载图片" aria-label="下载图片"><ArrowDownToLine aria-hidden="true" /></a>
                  </div>
                ) : (
                  <div className="generation-progress" role="status" aria-live="polite">
                    {active && <LoaderCircle className="spin" aria-hidden="true" />}
                    {!active && job.status === 'cancelled' && <Square aria-hidden="true" />}
                    <span>{active ? `${job.progress}%` : '可以重新开始一次生成'}</span>
                  </div>
                )}
              </div>
            </div>
          </article>
        ) : (
          <WorkbenchEmptyVisual />
        )}
      </div>
      <div className="composer-dock">
        <div className="composer-tool">
          <textarea id="generation-prompt" value={promptText} onChange={(event) => onPromptTextChange(event.target.value)} placeholder="描述你要生成的画面" maxLength={12_000} />
          <div className="composer-controls">
            <button className="composer-icon" type="button" title="添加素材" aria-label="添加素材"><span>+</span></button>
            <fieldset className="segmented-control ratio-control"><legend>比例</legend>{(['1:1', '16:9', '9:16'] as const).map((value) => <button key={value} type="button" data-active={ratio === value} onClick={() => onRatioChange(value)}>{value}</button>)}</fieldset>
            <div className="composer-settings-wrap">
              <button className="composer-settings" type="button" title="生成设置" aria-label="生成设置" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)}><SlidersHorizontal aria-hidden="true" /><span>{quality === 'high' ? '精细' : quality === 'low' ? '快速' : '标准'} · 1张</span></button>
              {settingsOpen && (
                <div className="composer-options" role="dialog" aria-label="生成设置">
                  <strong>生成设置</strong>
                  <span>质量</span>
                  <div className="option-row" role="radiogroup" aria-label="图片质量">
                    {(['low', 'medium', 'high'] as const).map((value) => (
                      <button key={value} type="button" role="radio" aria-checked={quality === value} data-active={quality === value} onClick={() => { onQualityChange(value); setSettingsOpen(false); }}>
                        {{ low: '快速', medium: '标准', high: '精细' }[value]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {active ? <button className="submit-icon submit-cancel" type="button" onClick={onCancel} title="取消生成" aria-label="取消生成"><Square aria-hidden="true" /></button> : <button className="submit-icon" type="button" disabled={!promptText.trim() || !canGenerate} onClick={onSubmit} title="生成图片" aria-label="生成图片"><WandSparkles aria-hidden="true" /></button>}
          </div>
          {error && <p className="form-error composer-error" role="alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}

function WorkbenchEmptyVisual() {
  return (
    <div className="workbench-empty" data-testid="workbench-empty">
      <img className="workbench-logo" src={musefoldLogoUrl} alt="Musefold / 未像" />
      <h2>让灵感成为图像。</h2>
      <p>从一张图、一段文字或一个方向开始</p>
    </div>
  );
}

function PromptLibraryView({ prompts, onUse }: { prompts: PromptDocument[]; onUse: (prompt: PromptDocument) => void }) {
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return prompts;
    return prompts.filter((prompt) => [prompt.title, prompt.content, ...prompt.tags]
      .some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [prompts, query]);

  const copyPrompt = async (prompt: PromptDocument) => {
    await navigator.clipboard.writeText(prompt.content);
    setCopiedId(prompt.id);
    window.setTimeout(() => setCopiedId(null), 1_200);
  };

  return (
    <section className="page library-page">
      <div className="library-heading">
        <div><h1>提示词库</h1><span>{filtered.length}</span></div>
        <button className="button button-primary" type="button"><span>+</span>新建</button>
      </div>
      <div className="library-toolbar">
        <label className="search-field">
          <Search aria-hidden="true" />
          <span className="sr-only">搜索提示词</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或标签" />
        </label>
      </div>
      <div className="prompt-sections" role="list">
        {(['pinned', 'all'] as const).map((section) => {
          const items = section === 'pinned' ? filtered.filter((prompt) => prompt.isPinned) : filtered.filter((prompt) => !prompt.isPinned);
          if (items.length === 0) return null;
          return <section className="prompt-section" key={section}><div className="prompt-section-heading"><h2>{section === 'pinned' ? '置顶' : '全部'}</h2><span>{items.length}</span></div><div className="prompt-grid">
          {items.map((prompt) => (
          <article className="prompt-row" role="listitem" key={prompt.id}>
            <span className="prompt-thumb"><FileText aria-hidden="true" /></span>
            <div className="prompt-row-main">
              <div className="prompt-title-line"><h2>{prompt.title}</h2></div>
              <p>{prompt.description ?? prompt.content}</p>
              <div className="tag-line"><span>使用 {prompt.usageCount} 次</span><span>{prompt.tags.join(' · ')}</span></div>
            </div>
            <div className="prompt-actions">
              <button className="icon-button" type="button" onClick={() => void copyPrompt(prompt)} title="复制提示词" aria-label={`复制 ${prompt.title}`}>
                {copiedId === prompt.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </button>
              <button className="text-action" type="button" onClick={() => onUse(prompt)}>使用</button>
            </div>
          </article>
          ))}</div></section>;
        })}
        {filtered.length === 0 && <div className="empty-row">没有匹配的提示词</div>}
      </div>
    </section>
  );
}

function AccountView({ session, mode, onLogout }: { session: AccountSession; mode: WebGateway['mode']; onLogout: () => Promise<void> }) {
  const account = session.account;
  return (
    <section className="page account-page">
      <div className="settings-heading"><h1>账户</h1><p>个人账户与生图额度</p></div>
      <div className="account-summary">
        <span className="account-avatar account-avatar-large">{(account.displayName ?? account.username).slice(0, 1)}</span>
        <div><h2>{account.displayName ?? account.username}</h2><p>@{account.username}</p></div>
      </div>
      <dl className="account-facts">
        <div><dt>可用额度</dt><dd>{account.quota} {account.quotaUnit}</dd></div>
        <div><dt>生图状态</dt><dd><span className="status-dot" />{account.canGenerate ? '可用' : '额度不足'}</dd></div>
        <div><dt>数据源</dt><dd>{mode === 'fixture' ? '开发预览' : 'Musefold Cloud'}</dd></div>
      </dl>
      <button className="button button-secondary logout-button" type="button" onClick={() => void onLogout()}>
        <LogOut aria-hidden="true" />退出登录
      </button>
    </section>
  );
}

function MobileNavigation({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  return (
    <nav className="mobile-nav" aria-label="移动端导航">
      <NavButton active={view === 'generate'} icon={<WandSparkles />} label="制作工作台" onClick={() => onNavigate('generate')} />
      <NavButton active={view === 'prompts'} icon={<Library />} label="提示词库" onClick={() => onNavigate('prompts')} />
      <NavButton active={view === 'account'} icon={<CircleUserRound />} label="账户" onClick={() => onNavigate('account')} />
    </nav>
  );
}
