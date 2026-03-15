import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), ...alphaTab()],
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@db': path.resolve(__dirname, 'src/db'),
    },
  },
  assetsInclude: ['**/*.sf2'],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    target: 'esnext',
  },
});
