import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const apiProxy = {
  '/api': {
    target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
    changeOrigin: true
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: true,
    strictPort: true,
    port: 8085,
    proxy: apiProxy,
    headers: {
      'Permissions-Policy': 'microphone=(), camera=(self)'
    }
  },
  preview: {
    host: true,
    strictPort: true,
    port: 8085,
    proxy: apiProxy,
    headers: {
      'Permissions-Policy': 'microphone=(), camera=(self)'
    }
  }
})
