/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff', 100: '#d9edff', 200: '#bce0ff', 300: '#8eccff',
          400: '#59b0ff', 500: '#338eff', 600: '#1b6ef5', 700: '#1458e1',
          800: '#1748b6', 900: '#193e8f', 950: '#142757',
        },
        surface: {
          50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
          700: '#1e293b', 800: '#0f172a', 900: '#020617', 950: '#01040f',
        },
      },
    },
  },
  plugins: [],
};