import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  // SSR/SSG 构建：把前端依赖（react / react-router / tiptap…）全部打进单一 Node bundle，
  // 这样生产只需要 frontend/dist-ssr/entry-server.js 一个文件，不用在服务器上装前端 node_modules。
  ssr: {
    noExternal: true,
    target: 'node'
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
