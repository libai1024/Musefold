import { useEffect, useState } from 'react';
import { Button } from '@musefold/legacy-ui';

type CeramicTheme = 'light' | 'dark';

function getSystemTheme(): CeramicTheme {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function CeramicButtonDemoView() {
  const [theme, setTheme] = useState<CeramicTheme>(getSystemTheme);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = (isDark: boolean) => {
      const nextTheme = isDark ? 'dark' : 'light';
      setTheme(nextTheme);
      root.dataset.theme = nextTheme;
    };
    const handleThemeChange = (event: MediaQueryListEvent) => updateTheme(event.matches);

    updateTheme(media.matches);
    media.addEventListener('change', handleThemeChange);
    return () => {
      media.removeEventListener('change', handleThemeChange);
      if (previousTheme) root.dataset.theme = previousTheme;
      else delete root.dataset.theme;
    };
  }, []);

  return (
    <main className="mf-ceramic-button-demo" data-ui-register="operate" data-theme={theme}>
      <Button className="mf-ceramic-button" data-testid="ceramic-button" unstyled>
        开始创作
      </Button>
    </main>
  );
}
