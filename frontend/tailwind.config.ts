import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        parchment: '#e9dfc7',
        ink: '#1a1410',
        gilt: '#b18b4a',
        oxblood: '#5b1f1f',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Garamond', 'serif'],
        body: ['EB Garamond', 'Garamond', 'serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
