// 关于页「支持」卡(自 AboutSection 拆出):三行支持入口 + 开源许可 Dialog。
// 许可数据在 apps/desktop/src/features/settings/third-party-notices.ts。
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { THIRD_PARTY_PACKAGES } from '../third-party-notices';

function SupportRow({
  title,
  description,
  action,
  onClick,
  testId,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <div className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-primary">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">{description}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onClick} data-testid={testId}>
        {action}
      </Button>
    </div>
  );
}

export function AboutSupportCard({
  onOpenDocs,
  onCopyFeedback,
}: {
  onOpenDocs: () => void;
  onCopyFeedback: () => void;
}) {
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <>
      <SupportRow
        title="产品文档"
        description="打开随应用提供的功能与数据说明"
        action="打开"
        onClick={onOpenDocs}
        testId="about-open-docs"
      />
      <SupportRow
        title="问题反馈"
        description="复制版本、系统与复现信息模板"
        action="复制信息"
        onClick={onCopyFeedback}
        testId="about-copy-feedback"
      />
      <SupportRow
        title="开源许可"
        description="Musefold 使用 MIT 许可，并包含第三方开源组件"
        action="查看"
        onClick={() => setLicensesOpen(true)}
        testId="about-open-licenses"
      />

      <Dialog open={licensesOpen} onOpenChange={setLicensesOpen}>
        <DialogContent className="max-w-xl" data-testid="about-licenses-dialog">
          <DialogHeader>
            <DialogTitle>开源许可</DialogTitle>
            <DialogDescription>
              Musefold 采用 MIT License。以下为发行包中的直接运行时依赖；各组件版权归原作者所有。
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[min(58vh,440px)] overflow-y-auto rounded-md border border-border-subtle bg-inset/35">
            {THIRD_PARTY_PACKAGES.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-4 border-b border-border-subtle px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 truncate font-mono text-[11px] text-secondary">
                  {item.name}
                </span>
                <span className="shrink-0 text-meta font-medium text-tertiary">{item.license}</span>
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" size="sm" onClick={() => setLicensesOpen(false)}>
              完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
