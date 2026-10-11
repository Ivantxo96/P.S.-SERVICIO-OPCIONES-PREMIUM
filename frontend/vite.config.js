import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE = /<nombre-del-repo>/ al publicar en GitHub Pages (lo pone el workflow)
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  build: { chunkSizeWarningLimit: 900 },
});
