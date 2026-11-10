import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Development only: the browser calls /api/... on this Vite server, and Vite forwards it
  // to the backend. 127.0.0.1 is used on purpose (localhost can resolve to IPv6 on Windows).
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
})
