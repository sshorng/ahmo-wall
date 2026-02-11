import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/unsplash-api': {
        target: 'https://unsplash.com/napi',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/unsplash-api/, ''),
      },
    },
  },
})
