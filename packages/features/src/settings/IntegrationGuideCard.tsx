'use client';

import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { AutomationCopyButton, automationErrorMessage, copyAutomationText } from './automation-ui';
import { useAutomationIntegrationGuide } from './hooks';

/**
 * 接入向导卡(07-04 §2.2):「在 Agent 里使用 Musefold」。
 *
 * 本卡只做**文本 + 复制** —— 片段由主进程生成(用户主目录已折叠成 `~`),
 * 片段内不含任何密钥:MCP 服务器启动后经本机发现链自读令牌。
 * 旧版的「Skill 管理」条目属暂缓域,本卡不做。
 */
export function IntegrationGuideCard() {
  const guide = useAutomationIntegrationGuide();

  return (
    <Card data-testid="settings-automation-guide-card">
      <CardHeader>
        <CardTitle>接入向导</CardTitle>
        <CardDescription>
          把下面的片段粘进 Agent 的配置文件,它就能调用本机 Musefold;片段里不含令牌
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {guide.isPending && (
          <div className="flex flex-col gap-2" data-testid="settings-automation-guide-loading">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-16 w-full rounded-md" />
            ))}
          </div>
        )}

        {guide.isError && (
          <div className="flex flex-wrap items-center gap-2">
            <p
              className="min-w-0 flex-1 text-destructive text-xs"
              data-testid="settings-automation-guide-error"
            >
              接入片段生成失败:{automationErrorMessage(guide.error, '未知原因')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              data-testid="settings-automation-guide-retry"
              onClick={() => void guide.refetch()}
            >
              重试
            </Button>
          </div>
        )}

        {guide.data && (
          <>
            {!guide.data.bundledReady && (
              <p
                className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs"
                data-testid="settings-automation-guide-unbundled"
              >
                当前构建里没有内置 MCP 产物(开发态常见),片段仍可参考,但需要自行提供可执行文件。
              </p>
            )}

            <GuideSnippet
              title="Cursor"
              hint="写入 ~/.cursor/mcp.json 的 mcpServers 段"
              snippet={guide.data.mcpConfigJson}
              testId="mcp"
            />
            <GuideSnippet
              title="Codex / ChatGPT 桌面"
              hint="写入 ~/.codex/config.toml"
              snippet={guide.data.codexConfigToml}
              testId="codex"
            />
            <GuideSnippet
              title="Claude Code"
              hint="在终端里执行一次即可注册"
              snippet={guide.data.claudeCommand}
              testId="claude"
            />

            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="settings-automation-cli"
            >
              <span className="shrink-0 text-foreground text-sm">命令行工具</span>
              <Badge variant={guide.data.cliInstalled ? 'secondary' : 'outline'}>
                {guide.data.cliInstalled ? '已安装' : '未安装'}
              </Badge>
              {guide.data.cliInstalled && !guide.data.cliOnPath && (
                <Badge variant="outline" data-testid="settings-automation-cli-path-warning">
                  不在 PATH 上
                </Badge>
              )}
              <p className="w-full text-muted-foreground text-xs">
                {guide.data.cliInstalled
                  ? guide.data.cliOnPath
                    ? '终端里可直接用 musefold 命令。'
                    : '已安装但 shim 目录不在 PATH 上,需把它加入 shell 配置后重开终端。'
                  : '尚未安装;安装后终端与 Agent 都能用 musefold 命令。'}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GuideSnippet({
  title,
  hint,
  snippet,
  testId,
}: {
  title: string;
  hint: string;
  snippet: string;
  testId: string;
}) {
  return (
    <section className="flex flex-col gap-1" data-testid={`settings-automation-guide-${testId}`}>
      <div className="flex items-center gap-2">
        <h4 className="min-w-0 flex-1 font-medium text-foreground text-xs">
          {title}
          <span className="ml-2 font-normal text-muted-foreground">{hint}</span>
        </h4>
        <AutomationCopyButton
          label="复制"
          testId={`settings-automation-guide-${testId}-copy`}
          onCopy={() => copyAutomationText(snippet, `${title} 片段已复制`)}
        />
      </div>
      <pre className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
        <code>{snippet}</code>
      </pre>
    </section>
  );
}
