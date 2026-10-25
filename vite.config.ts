import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build works from any subpath (e.g. GitHub Pages).
  base: './',
  plugins: [react()],
});
