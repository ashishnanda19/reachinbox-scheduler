import type { Config } from 'tailwindcss';

// The ONE place for design tokens. Every value was sampled from the Figma screenshots (docs/figma); the same
// values are exposed as CSS variables in src/index.css for the few places that need them outside Tailwind.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1A1A1A', strong: '#0A0A0A', soft: '#5A5D63', muted: '#9AA09A', faint: '#B0B5B0', placeholder: '#A8ABA8' },
        line: '#E4E7E4',
        field: '#F5F8F5',
        editor: '#FAFAFA',
        card: '#F9FAFB',
        brand: { DEFAULT: '#05A540', text: '#3E9B45', light: '#E6F7ED' },
        pill: { fill: '#FDEED6', border: '#F2B98C', text: '#C2410C' },
        chip: { fill: '#EEF0EE' },
        callout: { fill: '#FEFCE8', bar: '#FAD346' },
        avatar: '#04C94F',
        star: { DEFAULT: '#B0B5B0', active: '#F5B301' },
        danger: '#D92D20',
        info: { fill: '#E8F1FF', text: '#1D4ED8', border: '#B6D0FF' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        pixel: ['Silkscreen', 'monospace'],
      },
      boxShadow: {
        popover: '0 8px 30px rgba(0,0,0,0.12)',
        menu: '0 6px 24px rgba(0,0,0,0.10)',
      },
    },
  },
  plugins: [],
} satisfies Config;
