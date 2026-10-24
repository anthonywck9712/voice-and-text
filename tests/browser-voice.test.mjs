import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserModule } from './load-browser-module.mjs';
const { browserVoiceChunks, getBrowserVoiceSnapshot, subscribeBrowserVoice } =
  await loadBrowserModule('../lib/browser-voice.ts');
const { generateVoiceChunks, VoiceChunkValidator } = await loadBrowserModule(
  '../lib/voice-chunks.ts',
);
const request = { text: 'Hello.', voice: 'af_heart', speed: 1 };
const chunk = {
  type: 'audio',
  index: 0,
  offset: 0,
  end: 6,
  samples: 1,
  sampleRate: 24000,
  channels: 1,
  audio: new Float32Array([0.1]),
  pauseAfter: 0,
  phrase: 0,
  count: 0,
  readPunctuation: false,
};
class FakeWorker {
  static instances = [];
  listeners = new Map();
  messages = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  addEventListener(type, fn) {
    const set = this.listeners.get(type) || new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  postMessage(data) {
    this.messages.push(data);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    for (const fn of this.listeners.get('message') || []) fn({ data });
  }
  respond(data) {
    this.emit({ jobId: this.messages.at(-1).jobId, ...data });
  }
}
const originalWorker = globalThis.Worker;
globalThis.Worker = FakeWorker;
const latest = () => FakeWorker.instances.at(-1);
const collect = async (source) => {
  const result = [];
  for await (const item of source) result.push(item);
  return result;
};
try {
  await test('worker output follows consumer demand and model progress updates subscribers', async () => {
    let notifications = 0;
    const unsubscribe = subscribeBrowserVoice(() => notifications++);
    const source = browserVoiceChunks(request, new AbortController().signal);
    const first = source.next();
    const worker = latest();
    assert.equal(worker.messages.length, 1);
    assert.equal(worker.messages[0].request.text, 'Hello.');
    worker.respond({
      type: 'progress',
      info: {
        stage: 'downloading',
        bytes: 50,
        total: 100,
        progress: 0.5,
        message: 'Downloading…',
      },
    });
    assert.equal(getBrowserVoiceSnapshot().progress, 0.5);
    worker.respond({ type: 'audio', chunk });
    assert.equal((await first).value, chunk);
    assert.equal(
      worker.messages.length,
      1,
      'no prefetch while the consumer is paused',
    );
    const done = source.next();
    assert.equal(worker.messages.at(-1).type, 'next');
    worker.respond({ type: 'done' });
    assert.equal((await done).done, true);
    assert.equal(getBrowserVoiceSnapshot().stage, 'ready');
    assert.equal(
      worker.terminated,
      false,
      'successful jobs retain the loaded engine',
    );
    assert.ok(notifications >= 3);
    unsubscribe();
  });
  await test('busy guard rejects overlapping jobs and abort settles stalled model loading', async () => {
    const controller = new AbortController();
    const source = browserVoiceChunks(request, controller.signal);
    const pending = source.next();
    const worker = latest();
    await assert.rejects(
      browserVoiceChunks(request, new AbortController().signal).next(),
      /already being prepared/,
    );
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(worker.terminated, true);
    assert.equal(getBrowserVoiceSnapshot().stage, 'idle');
  });
  await test('initialization failure resets the engine so the next attempt can succeed', async () => {
    const failed = browserVoiceChunks(
      request,
      new AbortController().signal,
    ).next();
    const previous = latest();
    previous.respond({
      type: 'error',
      message: 'Model download failed. Please retry.',
      diagnostic: 'loading/TypeError',
    });
    await assert.rejects(failed, /download failed/);
    assert.equal(previous.terminated, true);
    assert.equal(getBrowserVoiceSnapshot().diagnostic, 'loading/TypeError');
    const source = browserVoiceChunks(request, new AbortController().signal);
    const first = source.next();
    assert.notEqual(latest(), previous);
    latest().respond({ type: 'audio', chunk });
    await first;
    const done = source.next();
    latest().respond({ type: 'done' });
    await done;
  });
  await test('switching engines releases the old worker and return discards unfinished inference', async () => {
    const previous = latest();
    const source = browserVoiceChunks(
      { ...request, voice: 'supertonic:F1' },
      new AbortController().signal,
    );
    const first = source.next();
    assert.equal(previous.terminated, true);
    const worker = latest();
    worker.respond({ type: 'audio', chunk: { ...chunk, sampleRate: 44100 } });
    await first;
    await source.return();
    assert.equal(worker.terminated, true);
  });
  await test('pre-cancelled jobs never create a worker', async () => {
    const count = FakeWorker.instances.length;
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      browserVoiceChunks(request, controller.signal).next(),
      { name: 'AbortError' },
    );
    assert.equal(FakeWorker.instances.length, count);
  });
} finally {
  globalThis.Worker = originalWorker;
}

await test('both browser engines preserve punctuation PCM silence and source coverage', async () => {
  for (const rate of [24000, 44100]) {
    const calls = [];
    const engine = {
      generate: async (text) => {
        calls.push(text);
        return { audio: new Float32Array([0.25, -0.25]), sampling_rate: rate };
      },
    };
    const options = {
      ...request,
      text: '“Hello, class!”\nWait... now.',
      dictationPause: 3,
      readPunctuation: true,
    };
    const chunks = await collect(
      generateVoiceChunks(engine, options, new AbortController().signal),
    );
    const validator = new VoiceChunkValidator(options);
    for (const item of chunks) validator.accept(item);
    validator.complete();
    const silent = Math.round(0.22 * rate);
    let marks = 0;
    for (const item of chunks) {
      if (item.samples === 2) continue;
      marks++;
      assert.equal(item.samples, silent + 2);
      assert.ok(item.audio.subarray(0, silent).every((v) => v === 0));
      assert.deepEqual([...item.audio.subarray(silent)], [0.25, -0.25]);
    }
    assert.equal(marks, 6);
    assert.deepEqual(
      chunks.filter((c) => c.pauseAfter).map((c) => [c.phrase, c.pauseAfter]),
      [
        [1, 3],
        [2, 3],
      ],
    );
    assert.equal(calls.filter((text) => text === 'full stop').length, 1);
  }
});
await test('long dictation chunks split without dropping text or duplicating writing gaps', async () => {
  const calls = [];
  const engine = {
    generate: async (text) => {
      calls.push(text);
      if (text.length > 35) throw new RangeError('VOICE_INPUT_TOO_LONG');
      return { audio: new Float32Array([0.1]), sampling_rate: 24000 };
    },
  };
  const options = {
    ...request,
    text: `${'Longword '.repeat(80)}...`,
    dictationPause: 8,
    readPunctuation: true,
  };
  const chunks = await collect(
    generateVoiceChunks(engine, options, new AbortController().signal),
  );
  const validator = new VoiceChunkValidator(options);
  for (const item of chunks) validator.accept(item);
  validator.complete();
  assert.ok(calls.every((text) => text.length <= 300));
  assert.equal(chunks.filter((c) => c.pauseAfter).length, 1);
  assert.equal(chunks.at(-1).pauseAfter, 8);
});
await test('cancellation after inference discards its audio before transfer', async () => {
  const controller = new AbortController();
  const engine = {
    generate: async () => {
      controller.abort();
      return { audio: new Float32Array([0.1]), sampling_rate: 24000 };
    },
  };
  await assert.rejects(
    collect(generateVoiceChunks(engine, request, controller.signal)),
    { name: 'AbortError' },
  );
});
