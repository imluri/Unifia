/** @type {import('tailwindcss').Config} */

// Consume a theme token (an RGB triple in a CSS var) while preserving Tailwind's
// opacity modifiers, e.g. bg-surface/60.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic surfaces / text — driven by the active theme.
        app: v('--bg-primary'),
        'bg-secondary': v('--bg-secondary'),
        'bg-tertiary': v('--bg-tertiary'),
        sidebar: v('--bg-secondary'),
        card: v('--surface'),
        surface: v('--surface'),
        'surface-hover': v('--surface-hover'),
        'border-subtle': v('--border-subtle'),
        'border-default': v('--border-default'),
        'border-strong': v('--border-strong'),
        accent: v('--accent'),
        'accent-contrast': v('--accent-contrast'),

        // Store badge colors (constant across themes).
        steam: '#1b6fb8',
        gog: '#8a2be2',
        epic: '#6b7280',
        custom: '#f59e0b',

        // Remap Tailwind's neutral ramp onto theme tokens so existing utility
        // classes (text-neutral-400, bg-neutral-800, …) follow the theme.
        neutral: {
          100: v('--text-primary'),
          200: v('--text-primary'),
          300: v('--text-secondary'),
          400: v('--text-secondary'),
          500: v('--text-muted'),
          600: v('--text-muted'),
          700: v('--border-strong'),
          800: v('--surface'),
          900: v('--bg-tertiary'),
          950: v('--bg-primary'),
        },
      },
      borderRadius: {
        // One theme-controlled radius "everywhere" (pills/circles keep 'full').
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius)',
        xl: 'var(--radius)',
        '2xl': 'var(--radius)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
