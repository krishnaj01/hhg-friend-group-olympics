import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER_PORT = Number(process.env.PORT ?? 3001);

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // expose on LAN so phones can join
    port: 5173,
    proxy: { '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true } },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
