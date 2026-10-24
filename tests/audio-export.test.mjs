import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserModule } from './load-browser-module.mjs';
const { createAudioFile } = await loadBrowserModule('../lib/audio-export.ts');
const request = { text: 'Hello.', voice: 'af_heart', speed: 1 };
const audio = (overrides = {}, values = [0.25]) => ({
  type: 'audio',
  index: 0,
  offset: 0,
  end: 6,
  pauseAfter: 0,
  phrase: 0,
  count: 0,
  readPunctuation: false,
  sampleRate: 24000,
  channels: 1,
  samples: values.length,
  audio: new Float32Array(values),
  ...overrides,
});
const from = (chunks) =>
  async function* () {
    yield* chunks;
  };
const render = (chunks, options = {}, progress = () => {}) =>
  createAudioFile(
    { ...request, ...options },
    new AbortController().signal,
    progress,
    from(chunks),
  );

await test('WAV header supports both free engines with clamped signed PCM16 and complete progress', async () => {
  for (const sampleRate of [24000, 44100]) {
    const progress = [];
    const result = await render(
      [audio({ sampleRate }, [-2, -1, -0.5, 0, 0.5, 1, 2])],
      {},
      (p) => progress.push(p),
    );
    const bytes = Buffer.from(await result.blob.arrayBuffer());
    assert.equal(result.blob.type, 'audio/wav');
    assert.equal(result.duration, 7 / sampleRate);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
    assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), sampleRate);
    assert.equal(bytes.readUInt32LE(28), sampleRate * 2);
    assert.equal(bytes.readUInt16LE(32), 2);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.toString('ascii', 36, 40), 'data');
    assert.equal(bytes.readUInt32LE(40), 14);
    assert.deepEqual(
      Array.from({ length: 7 }, (_, i) => bytes.readInt16LE(44 + i * 2)),
      [-32768, -32768, -16384, 0, 16384, 32767, 32767],
    );
    assert.deepEqual(progress, [0, 0.99, 1]);
  }
});
await test('subdivided dictation adds exactly one writing gap per phrase, including its final gap', async () => {
  for (const sampleRate of [24000, 44100]) {
    const chunks = [
      audio({ end: 2, phrase: 1, count: 2, sampleRate }),
      audio({
        index: 1,
        offset: 2,
        end: 6,
        phrase: 1,
        count: 2,
        pauseAfter: 3,
        sampleRate,
      }),
      audio({
        index: 2,
        offset: 7,
        end: 11,
        phrase: 2,
        count: 2,
        pauseAfter: 3,
        sampleRate,
      }),
    ];
    const { blob, duration } = await render(chunks, {
      text: 'Hello.\nBye.',
      dictationPause: 3,
    });
    const data = Buffer.from(await blob.arrayBuffer()).subarray(44);
    assert.equal(duration, 6 + 3 / sampleRate);
    assert.ok(data.subarray(4, 4 + 3 * sampleRate * 2).every((v) => v === 0));
    assert.equal(data.readInt16LE(4 + 3 * sampleRate * 2), 8192);
    assert.ok(data.subarray(6 + 3 * sampleRate * 2).every((v) => v === 0));
  }
});
await test('missing, duplicated and out-of-order source ranges never produce a partial file', async () => {
  for (const chunks of [
    [],
    [audio({ index: 1 })],
    [audio(), audio()],
    [audio({ offset: 1 })],
    [audio({ end: 5 })],
    [audio({ end: 3 }), audio({ index: 1, offset: 2 })],
    [audio({ end: 2 }), audio({ index: 1, offset: 3 })],
    [audio({ offset: 0.5 })],
    [audio({ end: 7 })],
  ])
    await assert.rejects(render(chunks), /incomplete or invalid/);
});
await test('invalid PCM, mixed sampling rates and unacknowledged punctuation are rejected', async () => {
  for (const value of [NaN, Infinity, -Infinity])
    await assert.rejects(render([audio({}, [value])]), /incomplete or invalid/);
  for (const overrides of [
    { sampleRate: 22050 },
    { channels: 2 },
    { samples: 0 },
    { samples: 2 },
    { audio: [] },
    { pauseAfter: 3 },
    { phrase: 1 },
  ])
    await assert.rejects(render([audio(overrides)]), /incomplete or invalid/);
  await assert.rejects(
    render([
      audio({ end: 3 }),
      audio({ index: 1, offset: 3, sampleRate: 44100 }),
    ]),
    /incomplete or invalid/,
  );
  await assert.rejects(
    render([audio({ phrase: 1, count: 1, pauseAfter: 3 })], {
      dictationPause: 3,
      readPunctuation: true,
    }),
    /incomplete or invalid/,
  );
});
await test('wrong phrase counts or writing pauses are rejected', async () => {
  const correct = audio({ phrase: 1, count: 1, pauseAfter: 3 });
  for (const overrides of [
    { phrase: 2 },
    { count: 3 },
    { pauseAfter: 0 },
    { pauseAfter: 8 },
    { end: 5 },
  ])
    await assert.rejects(
      render([{ ...correct, ...overrides }], { dictationPause: 3 }),
      /writing pauses/,
    );
});
await test('60-minute limit is enforced before inference and no export starts after cancellation', async () => {
  let called = false;
  const source = async function* () {
    called = true;
    yield audio();
  };
  await assert.rejects(
    createAudioFile(
      {
        ...request,
        text: Array(120).fill('Phrase.').join('\n'),
        dictationPause: 30,
      },
      new AbortController().signal,
      () => {},
      source,
    ),
    /60 minutes/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createAudioFile(request, controller.signal, () => {}, source),
    { name: 'AbortError' },
  );
  assert.equal(called, false);
});
await test('cancelling after a chunk never returns a partial WAV and closes the source', async () => {
  const controller = new AbortController();
  let closed = false;
  const source = async function* () {
    try {
      yield audio();
      controller.abort();
    } finally {
      closed = true;
    }
  };
  await assert.rejects(
    createAudioFile(request, controller.signal, () => {}, source),
    { name: 'AbortError' },
  );
  assert.equal(closed, true);
});
await test('an engine error is surfaced and never saved as a successful file', async () => {
  const source = async function* () {
    yield audio();
    throw new Error('Model unavailable; retry.');
  };
  await assert.rejects(
    createAudioFile(request, new AbortController().signal, () => {}, source),
    /Model unavailable; retry/,
  );
});
