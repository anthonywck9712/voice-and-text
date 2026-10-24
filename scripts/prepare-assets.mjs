import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
await mkdir('public/pdfjs', { recursive: true });
await copyFile(
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'public/pdfjs/pdf.worker.min.mjs',
);
await mkdir('public/ort', { recursive: true });
for (const name of [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
]) {
  await copyFile(
    `node_modules/onnxruntime-web/dist/${name}`,
    `public/ort/${name}`,
  );
}
// Kokoro uses Transformers 3 and requires its matching ONNX runtime binaries.
const require = createRequire(import.meta.url);
const v3 = createRequire(require.resolve('@huggingface/transformers-v3'));
const v3Ort = dirname(v3.resolve('onnxruntime-web'));
await mkdir('public/ort-kokoro', { recursive: true });
for (const name of [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]) {
  await copyFile(resolve(v3Ort, name), resolve('public/ort-kokoro', name));
}
console.log(
  'Browser speech runtimes prepared. Models download directly to each visitor’s browser cache.',
);
