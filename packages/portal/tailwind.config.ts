import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'mlops-primary': '#ca2b7f',
        'mlops-secondary': '#4086c6',
        'techtickets-primary': '#ee4443',
        'techtickets-secondary': '#1e2837',
      },
    },
  },
  plugins: [],
}

export default config
