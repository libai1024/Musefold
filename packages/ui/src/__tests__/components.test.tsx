import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card';
import { Input } from '../components/input';
import { Label } from '../components/label';
import { Separator } from '../components/separator';
import { Skeleton } from '../components/skeleton';
import { cn } from '../lib/utils';

describe('@musefold/ui shadcn components', () => {
  it('renders button variants with theme classes', () => {
    const html = renderToStaticMarkup(<Button variant="destructive">删除</Button>);
    expect(html).toContain('删除');
    expect(html).toContain('bg-destructive');
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

  it('cn merges tailwind classes with later value winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', false, 'font-medium')).toBe('text-sm font-medium');
  });
});
