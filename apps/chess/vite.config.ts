import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: process.env.APP_BASE ? `${process.env.APP_BASE.replace(/\/$/, '')}/` : '/',
    plugins: [react(), tailwindcss()],
    build: {
      // Keep large third-party libraries in their own cacheable chunks so the app
      // entry stays under Vite's 500 kB warning limit.
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'vendor-motion', test: /node_modules[\\/](motion|motion-dom|motion-utils)[\\/]/ },
              { name: 'vendor-chessboard', test: /node_modules[\\/](react-chessboard|chess\.js)[\\/]/ },
            ],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
