/**
 * Browser-only Supertonic 3 inference, adapted from the official MIT web example.
 * Modified: single-utterance typed arrays, bounded allocations, cached pinned
 * downloads, progress, failure cleanup, and explicit session disposal.
 * Source: supertone-oss-archive/supertonic@1e9799e964ea4c0dad7cde993b65c3c813a7b373
 * Model weights/presets: OpenRAIL-M; see public/licenses/supertonic-model.txt.
 */
import * as ort from 'onnxruntime-web/wasm';
import {
  SUPERTONIC_MODEL_URL,
  SUPERTONIC_MODEL_REVISION,
  SUPERTONIC_MODEL_FILES,
  SUPERTONIC_DOWNLOAD_BYTES,
  SUPERTONIC_SAMPLE_RATE,
  supertonicVoiceId,
  normalizeSupertonicText,
} from './supertonic-model';

type Progress = {
  stage: 'downloading' | 'initializing';
  bytes: number;
  total?: number;
  progress?: number;
  message: string;
};
type Config = {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
};
type Preset = {
  style_ttl: { dims: number[]; data: number[][][] };
  style_dp: { dims: number[]; data: number[][][] };
};
const CACHE_NAME = `voice-text-supertonic-${SUPERTONIC_MODEL_REVISION}`;

export async function loadSupertonic(onProgress: (info: Progress) => void) {
  // GitHub Pages cannot supply cross-origin isolation headers, so do not rely on
  // SharedArrayBuffer. Computation stays in the caller's dedicated Web Worker.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL(
    `${import.meta.env.BASE_URL}ort/`,
    globalThis.location.origin,
  ).href;
  let completedBytes = 0;
  let lastProgressAt = 0;
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch {
    /* Private mode/quota. */
  }
  const report = (stage: Progress['stage'], message: string, extra = 0) => {
    const now = performance.now();
    if (extra > 0 && now - lastProgressAt < 100) return;
    lastProgressAt = now;
    const bytes = completedBytes + extra;
    onProgress({
      stage,
      bytes,
      total: SUPERTONIC_DOWNLOAD_BYTES,
      progress: Math.min(1, bytes / SUPERTONIC_DOWNLOAD_BYTES),
      message,
    });
  };

  async function download(path: string, expectedBytes?: number) {
    const url = `${SUPERTONIC_MODEL_URL}/${path}`;
    let cached: Response | undefined;
    try {
      cached = await cache?.match(url);
    } catch {
      /* Continue without cache. */
    }
    if (cached) {
      const buffer = await cached.arrayBuffer();
      if (!expectedBytes || buffer.byteLength === expectedBytes) {
        if (expectedBytes) completedBytes += buffer.byteLength;
        report('downloading', 'Loading saved Supertonic model…');
        return buffer;
      }
      await cache?.delete(url).catch(() => {});
    }
    report('downloading', 'Downloading Supertonic voices for this device…');
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok)
        throw new Error(`Voice download failed (${response.status}).`);
      let buffer: ArrayBuffer;
      if (expectedBytes && response.body) {
        // The pinned asset size lets us avoid keeping a second complete copy of
        // a 256MB weight file while joining streamed chunks.
        const data = new Uint8Array(expectedBytes);
        let received = 0;
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            clearTimeout(timer);
            timer = setTimeout(() => controller.abort(), 120_000);
            if (received + value.length > data.length) {
              throw new Error(
                'Voice model download had an unexpected size. Please retry.',
              );
            }
            data.set(value, received);
            received += value.length;
            report(
              'downloading',
              'Downloading Supertonic voices for this device…',
              received,
            );
          }
        } finally {
          reader.releaseLock();
        }
        if (received !== expectedBytes)
          throw new Error('Voice download was interrupted. Please retry.');
        buffer = data.buffer;
      } else {
        buffer = await response.arrayBuffer();
        if (expectedBytes && buffer.byteLength !== expectedBytes) {
          throw new Error('Voice model download was incomplete. Please retry.');
        }
      }
      // Caching is optional; synthesis still works when storage is unavailable.
      try {
        await cache?.put(url, new Response(buffer));
      } catch {
        /* Quota/private mode. */
      }
      if (expectedBytes) completedBytes += buffer.byteLength;
      return buffer;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          'Voice download stalled. Check your connection and try again.',
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function json<T>(path: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await download(path))) as T;
  }
  const config = await json<Config>('onnx/tts.json');
  const indexer = await json<number[]>('onnx/unicode_indexer.json');
  if (
    config.ae.sample_rate !== SUPERTONIC_SAMPLE_RATE ||
    !Array.isArray(indexer)
  ) {
    throw new Error('The voice model configuration is incompatible.');
  }
  const sessions: ort.InferenceSession[] = [];
  const styles = new Map<string, { ttl: ort.Tensor; dp: ort.Tensor }>();
  try {
    for (const file of SUPERTONIC_MODEL_FILES) {
      const data = await download(`onnx/${file.name}.onnx`, file.bytes);
      report('initializing', 'Preparing Supertonic on this device…');
      sessions.push(
        await ort.InferenceSession.create(data, {
          executionProviders: ['wasm'],
        }),
      );
    }
  } catch (error) {
    await Promise.allSettled(sessions.map((session) => session.release()));
    throw error;
  }
  const [durationModel, textModel, vectorModel, vocoder] = sessions;
  let disposed = false;
  return {
    async generate(text: string, options: { voice: string; speed: number }) {
      if (disposed)
        throw new Error('Voice engine was stopped. Try reading again.');
      const voice = supertonicVoiceId(options.voice);
      if (
        !Number.isFinite(options.speed) ||
        options.speed < 0.5 ||
        options.speed > 2
      ) {
        throw new Error('Choose a speaking speed between 0.5× and 2×.');
      }
      // The outer worker chunks longer passages with original source offsets.
      if (text.length > 600)
        throw new Error(
          'This speech segment is too long. Split it into shorter phrases.',
        );
      let style = styles.get(voice);
      if (!style) {
        const preset = await json<Preset>(`voice_styles/${voice}.json`);
        style = {
          ttl: new ort.Tensor(
            'float32',
            new Float32Array(preset.style_ttl.data.flat(2)),
            preset.style_ttl.dims,
          ),
          dp: new ort.Tensor(
            'float32',
            new Float32Array(preset.style_dp.data.flat(2)),
            preset.style_dp.dims,
          ),
        };
        styles.set(voice, style);
      }
      const temporary = new Set<ort.Tensor>();
      const own = (tensor: ort.Tensor) => {
        temporary.add(tensor);
        return tensor;
      };
      const run = async (
        session: ort.InferenceSession,
        feeds: Record<string, ort.Tensor>,
      ) => {
        const output = await session.run(feeds);
        for (const tensor of Object.values(output)) own(tensor);
        return output;
      };
      try {
        const normalized = normalizeSupertonicText(text);
        const characters = Array.from(normalized);
        const ids = BigInt64Array.from(
          characters.map((char) => {
            const cp = char.codePointAt(0)!;
            return BigInt(cp < indexer.length ? indexer[cp] : -1);
          }),
        );
        const textIds = own(new ort.Tensor('int64', ids, [1, ids.length]));
        const textMask = own(
          new ort.Tensor('float32', new Float32Array(ids.length).fill(1), [
            1,
            1,
            ids.length,
          ]),
        );
        const durationOutput = await run(durationModel, {
          text_ids: textIds,
          style_dp: style.dp,
          text_mask: textMask,
        });
        const duration =
          Number(durationOutput.duration.data[0]) / options.speed;
        if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
          throw new Error(
            'This phrase could not be read. Try a shorter phrase.',
          );
        }
        const textOutput = await run(textModel, {
          text_ids: textIds,
          style_ttl: style.ttl,
          text_mask: textMask,
        });
        const samples = Math.floor(duration * SUPERTONIC_SAMPLE_RATE);
        const chunkSize =
          config.ae.base_chunk_size * config.ttl.chunk_compress_factor;
        const latentLength = Math.ceil(samples / chunkSize);
        const latentChannels =
          config.ttl.latent_dim * config.ttl.chunk_compress_factor;
        const noise = new Float32Array(latentChannels * latentLength);
        for (let i = 0; i < noise.length; i++) {
          noise[i] =
            Math.sqrt(-2 * Math.log(Math.max(0.0001, Math.random()))) *
            Math.cos(2 * Math.PI * Math.random());
        }
        let latent = own(
          new ort.Tensor('float32', noise, [1, latentChannels, latentLength]),
        );
        const latentMask = own(
          new ort.Tensor('float32', new Float32Array(latentLength).fill(1), [
            1,
            1,
            latentLength,
          ]),
        );
        const steps = 5;
        const totalSteps = own(
          new ort.Tensor('float32', new Float32Array([steps]), [1]),
        );
        for (let step = 0; step < steps; step++) {
          const output = await run(vectorModel, {
            noisy_latent: latent,
            text_emb: textOutput.text_emb,
            style_ttl: style.ttl,
            latent_mask: latentMask,
            text_mask: textMask,
            current_step: own(
              new ort.Tensor('float32', new Float32Array([step]), [1]),
            ),
            total_step: totalSteps,
          });
          latent = output.denoised_latent;
        }
        const output = await run(vocoder, { latent });
        const raw = output.wav_tts.data as Float32Array;
        const audio = new Float32Array(raw.subarray(0, samples));
        if (!audio.length || audio.some((sample) => !Number.isFinite(sample))) {
          throw new Error(
            'The voice produced invalid audio. Try this phrase again.',
          );
        }
        return { audio, sampling_rate: SUPERTONIC_SAMPLE_RATE };
      } finally {
        for (const tensor of temporary) tensor.dispose();
      }
    },
    async dispose() {
      disposed = true;
      for (const style of styles.values()) {
        style.ttl.dispose();
        style.dp.dispose();
      }
      styles.clear();
      await Promise.allSettled(sessions.map((session) => session.release()));
    },
  };
}
