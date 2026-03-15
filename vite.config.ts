import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
  },
  build: {
    target: 'esnext',
  },
});
