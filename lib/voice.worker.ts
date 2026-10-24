import { KokoroTTS } from 'kokoro-js';
import {
  AutoTokenizer,
  StyleTextToSpeech2Model,
  env,
} from '@huggingface/transformers-v3';
import {
  generateVoiceChunks,
  validateVoiceRequest,
  type VoiceEngine,
  type VoiceRequest,
  type VoiceChunk,
} from './voice-chunks';
import { NEURAL_VOICES } from './text';
import type { BrowserVoiceSnapshot } from './browser-voice';

const scope = self as unknown as {
  location: Location;
  postMessage(data: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.backends.onnx.wasm!.wasmPaths = new URL(
  `${import.meta.env.BASE_URL}ort-kokoro/`,
  scope.location.origin,
).href;

// Kokoro's preset loader is hardcoded to main. Pin those fixed public downloads
// alongside the model; no user text is included in any network request.
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const prefix = `https://huggingface.co/${MODEL}/resolve/main/voices/`;
  if (url.startsWith(prefix)) {
    const pinned = url.replace('/resolve/main/', `/resolve/${REVISION}/`);
    return originalFetch(
      input instanceof Request ? new Request(pinned, input) : pinned,
      init,
    );
  }
  return originalFetch(input, init);
};

let engine: Promise<VoiceEngine> | null = null;
let iterator: AsyncGenerator<VoiceChunk> | null = null;
let currentJob = 0;
let working = false;
let phase = 'starting';
const progress = (info: Omit<BrowserVoiceSnapshot, 'engine'>) =>
  scope.postMessage({ type: 'progress', jobId: currentJob, info });

async function load(request: VoiceRequest): Promise<VoiceEngine> {
  if (engine) return engine;
  engine = (async () => {
    if (request.voice.startsWith('supertonic:')) {
      const { loadSupertonic } = await import('./supertonic-engine');
      return loadSupertonic(progress);
    }
    const downloads = new Map<string, { loaded: number; total: number }>();
    const report = (event: {
      status: string;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (event.status === 'progress' && event.file)
        downloads.set(event.file, {
          loaded: event.loaded ?? 0,
          total: event.total ?? 0,
        });
      const values = [...downloads.values()];
      const bytes = values.reduce((sum, item) => sum + item.loaded, 0);
      const total = values.reduce((sum, item) => sum + item.total, 0);
      const ready = event.status === 'done' || event.status === 'ready';
      progress({
        stage: ready ? 'initializing' : 'downloading',
        bytes,
        ...(total ? { total, progress: Math.min(1, bytes / total) } : {}),
        message: ready
          ? 'Preparing the downloaded voice model…'
          : 'Downloading Kokoro for this device…',
      });
    };
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(MODEL, {
        revision: REVISION,
        dtype: 'q8',
        device: 'wasm',
        progress_callback: report,
      }),
      AutoTokenizer.from_pretrained(MODEL, {
        revision: REVISION,
        progress_callback: report,
      }),
    ]);
    // Never let Kokoro silently truncate expanded numbers or unusually long words.
    const checkedTokenizer = new Proxy(tokenizer, {
      apply(target, thisArg, args) {
        const tokens = Reflect.apply(target, thisArg, [
          args[0],
          { ...args[1], truncation: false },
        ]);
        if (tokens.input_ids.dims.at(-1) > 510)
          throw new RangeError('VOICE_INPUT_TOO_LONG');
        return tokens;
      },
    });
    const tts = new KokoroTTS(model, checkedTokenizer);
    return {
      generate: (text: string, options: { voice: string; speed: number }) =>
        tts.generate(text, {
          ...options,
          voice: options.voice as keyof typeof tts.voices,
        }),
    };
  })().catch((error) => {
    engine = null;
    throw error;
  });
  return engine;
}

scope.onmessage = async ({ data }) => {
  if (working) {
    scope.postMessage({
      type: 'error',
      jobId: data.jobId,
      message:
        'The voice engine is still busy. Stop the current reading and retry.',
    });
    return;
  }
  if (data.type === 'next' && data.jobId !== currentJob) return;
  working = true;
  try {
    if (data.type === 'start') {
      if (iterator) throw new Error('BUSY');
      currentJob = data.jobId;
      const request = data.request as VoiceRequest;
      validateVoiceRequest(request);
      if (
        !NEURAL_VOICES.some(
          (voice) => voice.voiceURI === `neural:${request.voice}`,
        )
      )
        throw new Error('VOICE_UNAVAILABLE');
      phase = 'loading';
      const tts = await load(request);
      iterator = generateVoiceChunks(
        tts,
        request,
        new AbortController().signal,
      );
    } else if (data.type !== 'next' || !iterator)
      throw new Error('INVALID_REQUEST');
    phase = 'generating';
    progress({
      stage: 'generating',
      bytes: 0,
      message: 'Creating speech on this device…',
    });
    const result = await iterator!.next();
    if (result.done) {
      iterator = null;
      scope.postMessage({ type: 'done', jobId: currentJob });
    } else {
      const chunk = result.value;
      scope.postMessage({ type: 'audio', jobId: currentJob, chunk }, [
        chunk.audio.buffer,
      ]);
    }
  } catch (error) {
    iterator = null;
    // Detailed inference errors can contain source text. Keep it on the device
    // and surface a generic recovery message, without logging it.
    scope.postMessage({
      type: 'error',
      jobId: currentJob,
      diagnostic: `${phase}/${error instanceof Error ? error.name : 'UnknownError'}`,
      message:
        'This voice could not finish. Check your connection and available memory, then retry with a shorter passage or another voice.',
    });
  } finally {
    working = false;
  }
};
