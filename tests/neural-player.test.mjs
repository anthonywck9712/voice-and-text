import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserModule } from './load-browser-module.mjs';
const { NeuralPlayer } = await loadBrowserModule('../lib/neural-player.ts');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const tick = () => new Promise((resolve) => setTimeout(resolve, 90));

class FakeContext {
  static latest;
  currentTime = 0;
  state = 'suspended';
  starts = [];
  destination = {};
  constructor() {
    FakeContext.latest = this;
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
  advance(seconds) {
    if (this.state === 'running') this.currentTime += seconds;
  }
  createBuffer(_, length, rate) {
    return {
      duration: length / rate,
      samples: null,
      copyToChannel(data) {
        this.samples = new Float32Array(data);
      },
    };
  }
  createBufferSource() {
    const context = this;
    return {
      buffer: null,
      stopped: false,
      connect() {},
      disconnect() {},
      stop() {
        this.stopped = true;
      },
      start(when) {
        context.starts.push({ when, source: this, buffer: this.buffer });
      },
    };
  }
}

function record(
  index,
  offset,
  end,
  extra = {},
  { seconds = 0.1, silence = 0 } = {},
) {
  const pcm = new Float32Array(Math.round((seconds + silence) * 24000));
  pcm.fill(0.1, Math.round(silence * 24000));
  return {
    type: 'audio',
    index,
    offset,
    end,
    audio: pcm,
    samples: pcm.length,
    sampleRate: 24000,
    channels: 1,
    pauseAfter: 0,
    phrase: 0,
    count: 0,
    readPunctuation: false,
    ...extra,
  };
}

async function exercise(text, options, run) {
  const originalContext = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  let wake,
    closed = false,
    canceled = false;
  const queue = [];
  const source = async function* (_, signal) {
    const onAbort = () => wake?.();
    signal.addEventListener('abort', onAbort);
    try {
      while (!signal.aborted) {
        if (!queue.length && !closed)
          await new Promise((resolve) => {
            wake = resolve;
          });
        if (signal.aborted) return;
        if (queue.length) {
          const item = queue.shift();
          if (item.type === 'done') return;
          yield item;
        } else if (closed) return;
      }
    } finally {
      canceled = signal.aborted;
      signal.removeEventListener('abort', onAbort);
    }
  };
  const statuses = [],
    positions = [];
  const player = new NeuralPlayer(
    (s) => statuses.push(s),
    () => {},
    (p) => positions.push(p),
    source,
  );
  const playing = player.play(text, 'af_alloy', 1, options);
  void playing.catch(() => {});
  const send = (...records) => {
    queue.push(...records);
    wake?.();
  };
  try {
    await settle();
    await run({
      player,
      playing,
      send,
      statuses,
      positions,
      context: FakeContext.latest,
      end: () => {
        closed = true;
        wake?.();
      },
      preamble: () => {},
      canceled: () => canceled,
    });
  } finally {
    player.stop();
    await playing.catch(() => {});
    globalThis.AudioContext = originalContext;
  }
}

await test('the player remains preparing while the browser model loads', async () => {
  await exercise(
    'Hi.',
    {},
    async ({ preamble, send, end, playing, context, statuses }) => {
      preamble();
      await settle();
      assert.equal(context.starts.length, 0);
      assert.equal(statuses.at(-1), 'preparing');
      send(record(0, 0, 3), { type: 'done' });
      end();
      await playing;
      assert.equal(context.starts.length, 1);
    },
  );
});

await test('dictation starts the first complete phrase before the next arrives and keeps punctuation contiguous', async () => {
  await exercise(
    'Hi,\nBye.',
    { dictationPause: 3, readPunctuation: true },
    async ({ send, end, context, playing, player, statuses, positions }) => {
      const metadata = { phrase: 1, count: 2, readPunctuation: true };
      send(record(0, 0, 2, { ...metadata, pauseAfter: 0 }));
      await settle();
      assert.equal(
        context.starts.length,
        0,
        'words wait for the punctuation cue',
      );
      send(record(1, 2, 3, { ...metadata, pauseAfter: 3 }, { silence: 0.22 }));
      await settle();
      assert.equal(
        context.starts.length,
        2,
        'first phrase starts without waiting for a second phrase or done',
      );
      const [word, punctuation] = context.starts;
      assert.equal(punctuation.when, word.when + word.buffer.duration);
      assert.ok(
        punctuation.buffer.samples
          .slice(0, 5280)
          .every((sample) => sample === 0),
      );
      assert.ok(
        punctuation.buffer.samples[5280] > 0,
        'the existing 220 ms pause was not lengthened',
      );

      const finalMetadata = { phrase: 2, count: 2, readPunctuation: true };
      send(record(2, 4, 7, { ...finalMetadata, pauseAfter: 0 }));
      await settle();
      assert.equal(
        context.starts.length,
        2,
        'the next phrase also waits for its punctuation',
      );

      context.advance(punctuation.when + punctuation.buffer.duration + 0.5);
      await tick();
      assert.equal(statuses.at(-1), 'writing');
      const remaining = positions.at(-1).remaining;
      await player.togglePause();
      context.advance(90);
      await tick();
      assert.equal(statuses.at(-1), 'paused');
      assert.equal(positions.at(-1).remaining, remaining);
      send(
        record(3, 7, 8, { ...finalMetadata, pauseAfter: 3 }, { silence: 0.22 }),
        { type: 'done' },
      );
      end();
      await playing;
      assert.equal(context.starts.length, 4);
      assert.equal(context.state, 'suspended');
      assert.equal(
        context.starts[2].when,
        punctuation.when + punctuation.buffer.duration + 3,
      );
      await player.togglePause();
      context.advance(8);
      await tick();
      assert.equal(statuses.at(-1), 'idle');
      assert.equal(context.state, 'closed');
    },
  );
});

await test('done cannot flush an incomplete dictation phrase or silently skip a phrase', async () => {
  for (const skipLast of [false, true]) {
    await exercise(
      'Hi,\nBye.',
      { dictationPause: 3 },
      async ({ send, playing, context }) => {
        send(
          record(0, 0, skipLast ? 3 : 2, {
            phrase: 1,
            count: 2,
            pauseAfter: skipLast ? 3 : 0,
          }),
          { type: 'done' },
        );
        await assert.rejects(playing, /incomplete or invalid/);
        assert.equal(context.starts.length, skipLast ? 1 : 0);
        assert.equal(context.state, 'closed');
        assert.ok(context.starts.every(({ source }) => source.stopped));
      },
    );
  }
});

await test('stop cancels a pending stream read and discards unplayed punctuation segments', async () => {
  await exercise(
    'Hi,',
    { dictationPause: 3 },
    async ({ player, send, playing, context, canceled }) => {
      send(record(0, 0, 2, { phrase: 1, count: 1, pauseAfter: 0 }));
      await settle();
      player.stop();
      await playing;
      assert.equal(canceled(), true);
      assert.equal(context.starts.length, 0);
      assert.equal(context.state, 'closed');
    },
  );
});

await test('stop wakes backpressure while paused without scheduling a later phrase', async () => {
  await exercise(
    'One\nTwo\nThree',
    { dictationPause: 30 },
    async ({ player, send, playing, context, canceled }) => {
      send(
        record(0, 0, 3, { phrase: 1, count: 3, pauseAfter: 30 }),
        record(1, 4, 7, { phrase: 2, count: 3, pauseAfter: 30 }),
        record(2, 8, 13, { phrase: 3, count: 3, pauseAfter: 30 }),
        { type: 'done' },
      );
      await settle();
      assert.equal(
        context.starts.length,
        2,
        '45 second scheduling limit holds the third phrase',
      );
      await player.togglePause();
      player.stop();
      await playing;
      assert.equal(canceled(), true);
      assert.equal(context.starts.length, 2);
      assert.ok(context.starts.every(({ source }) => source.stopped));
      assert.equal(context.state, 'closed');
    },
  );
});

await test('ordinary reading starts the first complete chunk without waiting for more synthesis', async () => {
  for (const single of [false, true]) {
    await exercise(
      single ? 'One' : 'One two',
      {},
      async ({ send, end, playing, context }) => {
        send(record(0, 0, 3));
        await settle();
        assert.equal(context.starts.length, 1);
        if (!single) send(record(1, 4, 7));
        else send({ type: 'done' });
        await settle();
        assert.equal(context.starts.length, single ? 1 : 2);
        if (!single) send({ type: 'done' });
        end();
        await playing;
      },
    );
  }
});
