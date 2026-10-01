import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Expose inside the container so the published port 5173 works from the host.
    host: true,
    port: 5173,
    proxy: {
      // The Fastify backend runs on port 8080 in the same dev container.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
