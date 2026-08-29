'use client';

import { Button } from '@musefold/ui/components/button';

export function CeramicButtonDemo() {
  return (
    <main className="mf-ceramic-button-demo" data-ui-register="operate">
      <Button
        type="button"
        variant="ghost"
        className="mf-ceramic-button"
        data-testid="ceramic-button"
      >
        开始创作
      </Button>
    </main>
  );
}
