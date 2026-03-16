// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#00E5FF',    // Electric Cyan
        secondary: '#0066FF',  // Core Blue
        dark: '#0A0F14',       // Deep Dark (Background)
        surface: '#161C24',    // Card/UI
        border: '#2A3441',     // Separadores
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