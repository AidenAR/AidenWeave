/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#EEEFE9',
        card: '#FFFFFF',
        'card-border': '#D0D1C9',
        primary: '#1D1F27',
        muted: '#6B6C6A',
        accent: '#F54E00',
        'accent-secondary': '#FFBE2E',
        blue: '#1D4AFF',
        green: '#30A46C',
        purple: '#8B5CF6',
      },
      fontFamily: {
        serif: ['"Instrument Serif"', '"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
