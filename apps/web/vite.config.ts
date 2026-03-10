import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4010',
      },
      '/health': {
        target: 'http://127.0.0.1:4010',
      },
    },
  },
});
