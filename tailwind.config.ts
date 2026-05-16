import type { Config } from 'tailwindcss'

// "The Salon" design tokens. The CSS variable definitions live in
// app/globals.css so they're available to inline styles too — Tailwind
// utilities below are aliases that resolve to the same values.
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:           '#F1ECE2',
        paper:        '#FBF8F1',
        'paper-2':    '#F6F1E5',
        ink:          '#1B1814',
        'ink-2':      '#4A433B',
        'ink-3':      '#8A8276',
        rule:         '#DDD3C0',
        'rule-soft':  '#E9E2D2',
        accent:       '#6E1F2B',
        'accent-2':   '#8A2A38',
        'accent-soft':'#F2DDD9',
        positive:     '#2E5D3A',
      },
      fontFamily: {
        sans:     ['var(--font-geist)', 'system-ui', '-apple-system', 'sans-serif'],
        serif:    ['var(--font-instrument-serif)', 'Georgia', 'Cambria', 'serif'],
        wordmark: ['var(--font-newsreader)', 'Georgia', 'serif'],
      },
      fontSize: {
        'eyebrow': ['10px', { lineHeight: '1.4', letterSpacing: '0.18em' }],
      },
      animation: {
        'fade-in':   'fadeIn 0.4s ease-out',
        'slide-up':  'slideUp 0.3s ease-out',
        'pulse-dot': 'pulseDot 1.8s ease-in-out infinite',
        'marquee':   'marquee 32s linear infinite',
      },
      keyframes: {
        marquee: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.35' },
        },
      },
      borderRadius: {
        'card':  '6px',
        'pill':  '999px',
        'input': '4px',
      },
      boxShadow: {
        'card-accent': '0 8px 30px -18px rgba(110,31,43,0.5)',
        'tooltip':     '0 8px 30px -10px rgba(0,0,0,0.4)',
        'popover':     '0 12px 28px -10px rgba(0,0,0,0.18)',
      },
    },
  },
  plugins: [],
}

export default config
