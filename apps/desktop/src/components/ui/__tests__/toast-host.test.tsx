import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toastHost = readFileSync('apps/desktop/src/components/ui/toast-host.tsx', 'utf8');

describe('ToastHost', () => {
  it('composes every notification from shared semantic slots', () => {
    expect(toastHost).toContain('<ToastStatusIcon variant={t.variant} />');
    expect(toastHost).toContain('<ToastIcon>');
    expect(toastHost).toContain('<ToastBody>');
    expect(toastHost).toContain('<ToastAction');
    expect(toastHost).toContain('<ToastClose');
    expect(toastHost).toContain("t.variant === 'danger' || t.variant === 'warning'");
  });
});
