import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@ui': path.resolve(__dirname, 'src/ui'),
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
