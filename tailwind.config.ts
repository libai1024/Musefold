import type { Config } from 'tailwindcss';

export default {
  content: ['./apps/desktop/src/**/*.{ts,tsx,html}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: 'var(--bg-window)',
        sidebar: 'var(--bg-sidebar)',
        elevated: 'var(--bg-elevated)',
        popover: 'var(--bg-popover)',
        inset: 'var(--bg-inset)',
        hover: 'var(--bg-hover)',
        pressed: 'var(--bg-active)',
        primary: 'var(--fg-primary)',
        secondary: 'var(--fg-secondary)',
        tertiary: 'var(--fg-tertiary)',
        quaternary: 'var(--fg-quaternary)',
        'border-subtle': 'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-press': 'var(--accent-press)',
        'accent-soft': 'var(--accent-soft)',
        'on-accent': 'var(--on-accent)',
        'on-danger': 'var(--on-danger)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      // 让 border-subtle / border-default / border-strong（裸名）解析为 border-color。
      // Tailwind v4 下裸 border 默认回退 currentColor，会让所有分隔线过亮 —— 这里修正。
      borderColor: {
        subtle: 'var(--border-subtle)',
        default: 'var(--border-default)',
        strong: 'var(--border-strong)',
        accent: 'var(--accent)',
      },
      ringColor: {
        accent: 'var(--accent)',
      },
      fontFamily: {
        sans: '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
        mono: '"SF Mono", "Cascadia Code", "JetBrains Mono", ui-monospace, "Roboto Mono", monospace',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        pop: 'var(--shadow-pop)',
      },
      height: {
        'control-xs': 'var(--control-xs)',
        'control-sm': 'var(--control-sm)',
        'control-md': 'var(--control-md)',
        'control-lg': 'var(--control-lg)',
      },
      fontFamily: {
        theater: ['var(--font-theater)'],
      },
      fontSize: {
        page: ['var(--text-page)', { lineHeight: '1.25', fontWeight: '600' }],
        section: ['var(--text-section)', { lineHeight: '1.35', fontWeight: '600' }],
        body: ['var(--text-body)', { lineHeight: '1.45' }],
        meta: ['var(--text-meta)', { lineHeight: '1.4', fontWeight: '400' }],
      },
      maxWidth: {
        chat: '48rem',
        bubble: '34rem',
      },
      transitionTimingFunction: {
        spring: 'var(--ease-spring)',
        smooth: 'var(--ease-smooth)',
        out: 'var(--ease-out)',
      },
      backdropBlur: {
        glass: '30px',
      },
    },
  },
  plugins: [],
} satisfies Config;
