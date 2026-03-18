import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'demo-primary': '#ca2b7f',
        'demo-secondary': '#4086c6',
        'acme-primary': '#ee4443',
        'acme-secondary': '#1e2837',
      },
    },
  },
  plugins: [],
}

export default config
