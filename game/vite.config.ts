/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // In development the browser talks to the seller-agent Worker (`npm run worker:dev`)
    // through the same origin, so no CORS setup is needed. Production serves /api from the Worker.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    // Most game rules are pure functions, so the fast Node environment is the default.
    // A test that renders React opts into a browser-like DOM with a first-line comment:
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/core/**', 'src/state/**', 'src/deal/**', 'src/world/collision.ts', 'src/world/pathfinding.ts', 'shared/**', 'server/**'] },
  },
});
