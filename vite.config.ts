import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/web',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// }],
        },
      },
    },
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': process.env.API_PROXY ?? 'http://127.0.0.1:3001' },
  },
});
