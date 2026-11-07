/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f0f5fb',
          100: '#dbe7f4',
          200: '#b8cfe8',
          300: '#8aafd6',
          400: '#5a87c0',
          500: '#3a68a8',
          600: '#2c5288',
          700: '#243f6b',
          800: '#1e3251',
          900: '#172644',
          950: '#0f1a33',
        },
        brand: {
          50: '#f7faed',
          100: '#edf4d7',
          200: '#dce9b2',
          300: '#c5dc7e',
          400: '#afd052',
          500: '#9CC53B',
          600: '#9CC53B',
          700: '#7f9f2e',
          800: '#637d25',
          900: '#46591b',
        },
        accent: {
          50: '#f7faed',
          100: '#edf4d7',
          200: '#dce9b2',
          300: '#c5dc7e',
          400: '#afd052',
          500: '#9CC53B',
          600: '#7f9f2e',
          700: '#637d25',
        },
        success: {
          500: '#10b981',
          600: '#059669',
          700: '#047857',
        },
        warning: {
          500: '#f59e0b',
          600: '#d97706',
        },
        error: {
          500: '#ef4444',
          600: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        display: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(15 26 51 / 0.08), 0 1px 2px -1px rgb(15 26 51 / 0.08)',
        'card-hover': '0 8px 24px -4px rgb(15 26 51 / 0.16), 0 2px 6px -2px rgb(15 26 51 / 0.08)',
      },
    },
  },
  plugins: [],
};
