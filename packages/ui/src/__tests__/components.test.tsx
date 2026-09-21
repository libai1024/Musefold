import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Combobox } from '../components/combobox';
import { Badge } from '../components/badge';
import { MusefoldMark } from '../components/brand-mark';
import { Button } from '../components/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../components/card';
import { FadeImage } from '../components/fade-image';
import { Input } from '../components/input';
import { Kbd } from '../components/kbd';
import { Label } from '../components/label';
import { Separator } from '../components/separator';
import { Skeleton } from '../components/skeleton';
import { defaultToastPosition } from '../components/sonner';
import { cn } from '../lib/utils';

describe('@musefold/ui shadcn components', () => {
  it('renders button variants with theme classes', () => {
    const html = renderToStaticMarkup(<Button variant="destructive">删除</Button>);
    expect(html).toContain('删除');
    expect(html).toContain('bg-destructive');
  });

  it('button carries press state per craft §4 (C-3): scale + motion tokens', () => {
    const html = renderToStaticMarkup(<Button>开始</Button>);
    for (const cls of [
      'active:scale-[0.985]',
      'active:duration-(--dur-instant)',
      'duration-(--dur-fast)',
      'ease-out',
    ]) {
      expect(html).toContain(cls);
    }
  });

  it('keeps comfortable card padding at Tailwind 1.5rem and consumes density token when compact', () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader />
        <CardContent />
        <CardFooter />
      </Card>,
    );
    // 舒适态仍是 shadcn `py-6`/`px-6`(1.5rem);token 舒适值是 0.75rem,不能直接替换否则全端基线漂。
    expect(html).toContain('py-6');
    expect(html).toContain('px-6');
    expect(html).toContain('--density-card-padding');
  });

  it('renders composed card structure', () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>设置</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="name">名称</Label>
          <Input id="name" placeholder="输入名称" />
        </CardContent>
      </Card>,
    );
    expect(html).toContain('设置');
    expect(html).toContain('placeholder="输入名称"');
  });

  it('renders badge, separator and skeleton primitives', () => {
    expect(renderToStaticMarkup(<Badge>新</Badge>)).toContain('新');
    expect(renderToStaticMarkup(<Separator />)).toContain('shrink-0');
    expect(renderToStaticMarkup(<Skeleton className="h-4" />)).toContain('animate-pulse');
  });

  it('FadeImage starts hidden and reveals on load via motion token (C-5)', () => {
    const html = renderToStaticMarkup(<FadeImage src="/a.png" alt="" />);
    expect(html).toContain('data-loaded="false"');
    for (const cls of [
      'opacity-0',
      'transition-opacity',
      'duration-(--dur-fast)',
      'data-[loaded=true]:opacity-100',
    ]) {
      expect(html).toContain(cls);
    }
  });

  it('renders a typeable combobox with a suggestion list', () => {
    const html = renderToStaticMarkup(
      <Combobox
        value="gpt"
        onValueChange={() => undefined}
        options={[{ value: 'gpt-image-2', label: 'GPT Image' }]}
        data-testid="model"
      />,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('data-testid="model"');
    expect(html).toContain('gpt');
  });

  it('renders Kbd primitive per craft §5.4 anatomy (C-2)', () => {
    const html = renderToStaticMarkup(<Kbd>⌘N</Kbd>);
    expect(html).toContain('<kbd');
    expect(html).toContain('⌘N');
    // 形态锚点:11px mono、1px 边框、muted 底(暗色 secondary)、radius-sm。
    for (const cls of ['font-mono', 'text-[11px]', 'border-border', 'bg-muted', 'rounded-sm']) {
      expect(html).toContain(cls);
    }
  });

  it('renders brand mark with primary ember dot (v2.1 geometry preserved)', () => {
    const html = renderToStaticMarkup(<MusefoldMark className="size-4" />);
    expect(html).toContain('Musefold / 未像');
    expect(html).toContain('var(--primary)');
    expect(html).toContain('viewBox="0 0 100 100"');
  });

  it('places global toasts at desktop top-right and mobile top-center', () => {
    expect(defaultToastPosition(false)).toBe('top-right');
    expect(defaultToastPosition(true)).toBe('top-center');
  });

  it('cn merges tailwind classes with later value winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', false, 'font-medium')).toBe('text-sm font-medium');
  });
});

describe('C-1 动效 token(00-codex-craft §3,承旧 v2.5-baseline 原值)', () => {
  const globalsCss = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8');

  it('五档时长 + 两条承旧缓动落 @theme static,运行时 var() 可解析', () => {
    expect(globalsCss).toContain('--dur-instant: 90ms');
    expect(globalsCss).toContain('--dur-fast: 130ms');
    expect(globalsCss).toContain('--dur-base: 180ms');
    expect(globalsCss).toContain('--dur-med: 220ms');
    expect(globalsCss).toContain('--dur-slow: 260ms');
    expect(globalsCss).toContain('--ease-out: cubic-bezier(0.22, 1, 0.36, 1)');
    expect(globalsCss).toContain('--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)');
    expect(globalsCss).toMatch(/@theme static \{[^}]*--dur-instant/);
  });

  it('首个消费方:Dialog/AlertDialog 入场时长引用 token,不留裸毫秒值', () => {
    for (const file of ['dialog.tsx', 'alert-dialog.tsx']) {
      const source = readFileSync(new URL(`../components/${file}`, import.meta.url), 'utf8');
      expect(source, file).toContain('duration-(--dur-base)');
      expect(source, file).not.toContain('duration-200');
    }
  });
});
