import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The web app talks only to its own origin: /api (HTTP and the live-updates socket at /api/ws).
// In development Vite forwards /api to the tracker server, by default on this machine.
const target = process.env.TRACKER_API_URL || 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.TRACKER_WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': { target, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // React and the Markdown renderer change rarely: their own files stay cached across releases
        manualChunks: { react: ['react', 'react-dom'], markdown: ['react-markdown', 'remark-gfm'] },
      },
    },
  },
});
