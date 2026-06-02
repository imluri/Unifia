/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Unifia surface palette
        app: '#0f0f0f',
        sidebar: '#1a1a1a',
        card: '#242424',
        accent: '#3b82f6',
        // Store badge colors
        steam: '#1b6fb8',
        gog: '#8a2be2',
        epic: '#6b7280',
        custom: '#f59e0b',
      },
    },
  },
  plugins: [],
};
