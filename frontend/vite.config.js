import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Запросы /api уходят во Flask (backend/app.py)
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
