import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 3000,
    https: false, // 可以设置为 true 启用HTTPS，但需要证书
    host: '127.0.0.1', // 使用localhost确保crypto.subtle可用
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:46980',
        changeOrigin: true,
      }
    }
  },
  preview: {
    port: 4173,
    host: '127.0.0.1', // 预览模式也使用localhost
  },
});
