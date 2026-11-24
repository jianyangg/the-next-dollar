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
  build: {
    rollupOptions: {
      output: {
        // Split big, rarely-changing libraries into their own files. Browsers cache each file
        // by content hash, so a game-code release re-downloads only the small app chunk, not
        // three.js / React. (`postprocessing` and Motion's features are split automatically
        // by the dynamic import()s in the code, so they are not listed here.)
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/three\//.test(id)) return 'three';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
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
