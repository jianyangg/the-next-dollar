/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
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
