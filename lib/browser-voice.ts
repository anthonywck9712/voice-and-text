import {
  validateVoiceRequest,
  type VoiceChunk,
  type VoiceRequest,
} from './voice-chunks';

export type BrowserVoiceSnapshot = {
  stage:
    | 'idle'
    | 'downloading'
    | 'initializing'
    | 'generating'
    | 'ready'
    | 'error';
  bytes: number;
  total?: number;
  progress?: number;
  message: string;
  engine?: 'kokoro' | 'supertonic';
  diagnostic?: string;
};
let snapshot: BrowserVoiceSnapshot = {
  stage: 'idle',
  bytes: 0,
  message: 'Ready when you are.',
};
const listeners = new Set<() => void>();
export const getBrowserVoiceSnapshot = () => snapshot;
export const subscribeBrowserVoice = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function update(next: BrowserVoiceSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

let worker: Worker | null = null;
let workerEngine: string | undefined;
let active = false;
let sequence = 0;
const abortError = () =>
  new DOMException('Voice preparation cancelled.', 'AbortError');

/** One transferred chunk per demand: paused readers cannot accumulate an unbounded queue. */
export async function* browserVoiceChunks(
  request: VoiceRequest,
  signal: AbortSignal,
): AsyncGenerator<VoiceChunk> {
  validateVoiceRequest(request);
  signal.throwIfAborted();
  if (active)
    throw new Error(
      'A voice is already being prepared. Stop it before starting another reading or download.',
    );
  if (typeof Worker === 'undefined')
    throw new Error(
      'This browser cannot run neural voices. Try an up-to-date Chrome, Edge or Safari.',
    );
  active = true;
  const jobId = ++sequence;
  const engine = request.voice.startsWith('supertonic:')
    ? 'supertonic'
    : 'kokoro';
  let complete = false;
  let fatal: Error | undefined;
  let pending:
    | {
        resolve: (message: { type: string; chunk?: VoiceChunk }) => void;
        reject: (reason: unknown) => void;
      }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetWorker = () => {
    worker?.terminate();
    worker = null;
    workerEngine = undefined;
  };
  const fail = (error: Error, diagnostic?: string) => {
    fatal = error;
    clearTimeout(timer);
    resetWorker();
    update({
      stage: signal.aborted ? 'idle' : 'error',
      bytes: 0,
      engine,
      diagnostic,
      message: signal.aborted
        ? 'Stopped. Downloaded model files remain cached when your browser allows it.'
        : error.message,
    });
    pending?.reject(error);
    pending = undefined;
  };
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        fail(
          new Error(
            'Voice preparation stalled. Check your connection, close other busy tabs and try a shorter passage.',
          ),
        ),
      180000,
    );
  };
  const onAbort = () => fail(abortError());
  const onError = () =>
    fail(
      new Error(
        'The voice engine stopped. Try a shorter passage, close other busy tabs, then retry.',
      ),
    );
  const onMessage = ({ data }: MessageEvent) => {
    if (data.jobId !== jobId || fatal) return;
    if (data.type === 'progress') {
      update({ ...data.info, engine });
      if (pending) armTimeout();
    } else if (data.type === 'error') {
      // Diagnostic contains only operation phase and error class, never text,
      // audio, stack traces or the engine's potentially sensitive error message.
      if (typeof data.diagnostic === 'string')
        console.warn('Voice engine failed:', data.diagnostic);
      fail(
        new Error(
          typeof data.message === 'string'
            ? data.message
            : 'The voice could not load. Check your connection and retry.',
        ),
        data.diagnostic,
      );
    } else if (data.type === 'audio' || data.type === 'done') {
      clearTimeout(timer);
      if (!pending) {
        fail(
          new Error(
            'The voice engine returned unexpected audio. Please retry.',
          ),
        );
        return;
      }
      const resolve = pending.resolve;
      pending = undefined;
      resolve(data);
    }
  };
  let target: Worker | null = null;
  try {
    if (workerEngine && workerEngine !== engine) resetWorker();
    worker ??= new Worker(new URL('./voice.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerEngine = engine;
    target = worker;
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);
    target.addEventListener('messageerror', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    update({
      stage: 'initializing',
      bytes: 0,
      engine,
      message: 'Opening the voice engine on this device…',
    });
    let first = true;
    while (true) {
      signal.throwIfAborted();
      if (fatal) throw fatal;
      const response = await new Promise<{ type: string; chunk?: VoiceChunk }>(
        (resolve, reject) => {
          pending = { resolve, reject };
          armTimeout();
          target!.postMessage(
            first ? { type: 'start', jobId, request } : { type: 'next', jobId },
          );
          first = false;
        },
      );
      signal.throwIfAborted();
      if (response.type === 'done') {
        complete = true;
        update({
          stage: 'ready',
          bytes: 0,
          engine,
          message: 'Voice ready on this device.',
        });
        break;
      }
      yield response.chunk!;
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    target?.removeEventListener('message', onMessage);
    target?.removeEventListener('error', onError);
    target?.removeEventListener('messageerror', onError);
    if (!complete) resetWorker();
    active = false;
  }
}
