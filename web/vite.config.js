import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API lives on the Node service; proxying keeps the browser on one
    // origin so there's no CORS in dev either.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
