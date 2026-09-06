import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En developpement, l'API et le flux temps reel sont servis par le serveur
// partage (node server/index.js) : on les relaie pour travailler a chaud.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.IRTS_SERVER ?? 'http://localhost:8080',
        changeOrigin: true,
        ws: false,
      },
    },
  },
});
