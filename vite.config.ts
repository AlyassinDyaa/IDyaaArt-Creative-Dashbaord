import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend dev server. /api is proxied to the Express backend on :5174.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose on LAN so an iPad on the same network can reach it
    port: 5173,
    // Don't reload the app when documents are saved into the workspace on disk.
    watch: {
      ignored: ['**/entropy-workspace/**', '**/.entropy/**', '**/dist/**'],
    },
    proxy: {
      '/api': 'http://localhost:5174',
      '/files': 'http://localhost:5174',
    },
  },
  build: {
    outDir: 'dist',
  },
})
