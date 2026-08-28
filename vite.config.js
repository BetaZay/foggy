import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  publicDir: false,
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    cors: true,
  },
  build: {
    manifest: true,
    outDir: 'public/assets',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/frontend/main.js',
    },
  },
});
