import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5183,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
