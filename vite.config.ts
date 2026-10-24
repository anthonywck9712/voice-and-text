import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Kokoro constructs Tensor objects internally. Share its exact Transformers 3
// instance with our pinned loader; Whisper continues to use Transformers 4.
const kokoroRuntime = () => ({
  name: 'shared-kokoro-runtime',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (
      source === '@huggingface/transformers-v3' ||
      (source === '@huggingface/transformers' &&
        importer?.includes('/kokoro-js/'))
    ) {
      return fileURLToPath(
        new URL(
          './node_modules/@huggingface/transformers-v3/dist/transformers.web.js',
          import.meta.url,
        ),
      );
    }
  },
});

// A static SPA: the development server and GitHub Pages never process speech.
export default defineConfig({
  base: process.env.PAGES_BASE_PATH || '/',
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [kokoroRuntime(), react()],
  worker: { format: 'es', plugins: () => [kokoroRuntime()] },
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/.azure-speech.json',
        '**/.azure-speech.json.*.tmp',
      ],
    },
    watch: { useFsEvents: false, usePolling: true },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
