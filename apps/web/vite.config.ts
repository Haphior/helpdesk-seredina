import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same shape as production, where the web container's nginx serves the
    // API at /api (docs/adr/0054-server-address-and-tls.md).
    proxy: {
      '/api': {
        target: process.env.SEREDINA_DEV_API ?? 'http://localhost:4000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
