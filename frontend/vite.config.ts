import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  // GitHub Pages 会部署到 /<repository-name>/ 路径下
  // 如果你的仓库名是 wavitor，则设置为 '/wavitor/'
  // 如果使用自定义域名或用户页面，则设置为 '/'
  base: process.env.NODE_ENV === 'production' ? '/wavitor/' : '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
