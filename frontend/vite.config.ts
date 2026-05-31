import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        configure: (proxy) => {
          // Disable Nagle's algorithm so SSE chunks are not buffered in TCP
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.socket?.setNoDelay(true)
          })
        },
      },
    },
  },
})
