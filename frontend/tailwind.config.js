// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--primary-rgb) / <alpha-value>)',    // Electric Cyan mapped to rgb variable
        secondary: '#0066FF',  // Core Blue
        dark: 'var(--bg-dark)',       // Deep Dark (Background)
        surface: 'var(--bg-surface)', // Card/UI
        sidebar: 'var(--bg-sidebar)', // Sidebar background
        border: 'var(--border)',      // Separadores
        main: 'var(--text-main)',     // Texto principal
        muted: 'var(--text-muted)',   // Texto secundario
        success: '#10B981',    // Terminal Green
        error: '#EF4444',      // Runtime Red
        warning: '#F59E0B'     // Lint Yellow
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"Fira Code"', 'monospace'],
      }
    },
  },
  plugins: [],
}