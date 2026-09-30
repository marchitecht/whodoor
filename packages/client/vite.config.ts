import { defineConfig } from 'vite';

// BASE_PATH lets the game live under a path on an existing site, e.g. /games/whodoor/
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  build: { target: 'es2022' },
});
