import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'gatewaze-primary': '#00a2c7',
        'gatewaze-secondary': '#0a0a0a',
      },
    },
  },
  plugins: [],
}

export default config
