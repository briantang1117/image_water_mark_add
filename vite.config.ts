import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: true,
  },
  build: {
    rollupOptions: {
      output: {
        // GitHub Pages/Jekyll 会忽略 _ 下划线开头的文件，导致
        // _plugin-vue_export-helper-*.js 这类 chunk 404。
        // 去掉 chunk 名首部下划线，产物文件名不再以 _ 开头。
        chunkFileNames: (chunkInfo) => {
          const name = chunkInfo.name.replace(/^_+/, '')
          return `assets/${name}-[hash].js`
        },
      },
    },
  },
})
