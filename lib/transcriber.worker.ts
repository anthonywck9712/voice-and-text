import { assetUrl } from './assets';
import {
  env,
  pipeline,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type WhisperTokenizer,
} from '@huggingface/transformers';

const scope = self as unknown as {
  location: Location;
  postMessage: (data: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};
// Official HF repository revision verified 2026-10-25. Pin every tokenizer,
// encoder and decoder download so cached and first-use devices use one version.
const MODEL_ID = 'onnx-community/whisper-tiny.en';
const MODEL_REVISION = '2575352d61be1bf7225cf8f8b268a4678025fc58';
// Public weights are downloaded once and cached; recordings never leave the device.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm!.numThreads = 1;
// This code already runs in a module worker; no extra proxy worker or shared
// memory headers are required from GitHub Pages.
env.backends.onnx.wasm!.proxy = false;
// Preserve Transformers 4's browser-specific runtime choice. Its webgpu build
// uses Asyncify on Chromium/Firefox and plain WASM on Safari, not the older
// JSEP binary used by Kokoro's separate Transformers 3 runtime.
const defaultPaths = env.backends.onnx.wasm!.wasmPaths;
const plainWasm =
  typeof defaultPaths === 'object' &&
  typeof defaultPaths.mjs === 'string' &&
  defaultPaths.mjs.endsWith('/ort-wasm-simd-threaded.mjs');
const runtimeName = plainWasm
  ? 'ort-wasm-simd-threaded'
  : 'ort-wasm-simd-threaded.asyncify';
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL(assetUrl(`ort/${runtimeName}.mjs`), scope.location.origin).href,
  wasm: new URL(assetUrl(`ort/${runtimeName}.wasm`), scope.location.origin)
    .href,
};
let engine: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let working = false;
const downloads = new Map<string, number>();
async function load() {
  if (!engine) {
    downloads.clear();
    engine = pipeline('automatic-speech-recognition', MODEL_ID, {
      revision: MODEL_REVISION,
      device: 'wasm',
      dtype: 'q8',
      // ORT 1.26's extended MatMulNBits rewrite rejects the pinned quantized
      // Whisper decoder (onnxruntime#28306). Basic optimization avoids that
      // rewrite while retaining the small q8 download and CPU compatibility.
      session_options: { graphOptimizationLevel: 'basic' },
      progress_callback: (event) => {
        if (event.status === 'progress')
          downloads.set(event.file, event.loaded);
        scope.postMessage({
          type: 'loading',
          bytes: [...downloads.values()].reduce((a, b) => a + b, 0),
          stage: event.status === 'ready' ? 'initializing' : 'downloading',
        });
      },
    });
  }
  try {
    return await engine;
  } catch (error) {
    engine = null;
    // Only model loading uses this diagnostic. At this point no recording has
    // been passed to inference; it contains public asset/runtime errors only.
    console.warn('Whisper model load failed:', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message:
        error instanceof Error ? error.message : 'Unknown model loading error',
      runtime: runtimeName,
    });
    throw error;
  }
}
scope.onmessage = async ({ data }) => {
  if (working) {
    scope.postMessage({
      type: 'error',
      jobId: data.jobId,
      message: 'The speech model is still busy. Please retry.',
    });
    return;
  }
  working = true;
  try {
    const transcriber = await load();
    if (data.type === 'load') {
      scope.postMessage({ type: 'ready' });
      return;
    }
    if (
      data.type !== 'transcribe' ||
      !(data.audio instanceof Float32Array) ||
      !data.audio.length
    )
      throw new Error('Invalid audio');
    const streamer = new WhisperTextStreamer(
      transcriber.tokenizer as WhisperTokenizer,
      {
        skip_prompt: true,
        callback_function: (delta: string) =>
          scope.postMessage({ type: 'partial', jobId: data.jobId, delta }),
      },
    );
    const output = await transcriber(data.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      streamer,
    });
    const result = Array.isArray(output) ? output[0] : output;
    scope.postMessage({
      type: 'complete',
      jobId: data.jobId,
      text: result.text,
    });
  } catch (error) {
    // No input, transcripts, or credentials are logged.
    scope.postMessage({
      type: 'error',
      jobId: data.jobId,
      diagnostic: `${data.type === 'load' ? 'loading' : 'transcribing'}/${error instanceof Error ? error.name : 'UnknownError'}`,
      // Only the developer harness reads this. Loading has no user audio/text;
      // inference errors deliberately never include the engine's raw message.
      ...(data.type === 'load'
        ? {
            diagnosticMessage: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 2000),
            runtime: runtimeName,
          }
        : {}),
      message:
        data.type === 'load'
          ? 'The speech model could not load. Check your internet connection and available memory, then retry.'
          : 'Transcription stopped. Try a shorter recording or file. Your completed transcript is still here.',
    });
  } finally {
    working = false;
  }
};
