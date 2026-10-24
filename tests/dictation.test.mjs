import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { loadBrowserModule } from './load-browser-module.mjs';
import {
  dictationPhrases,
  phraseBreaks,
  passageError,
} from '../lib/dictation.ts';
import { pdfPageText } from '../lib/passage-text.ts';
const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
async function loadClass(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  source = source.replaceAll(
    "from './dictation'",
    `from '${new URL('../lib/dictation.ts', import.meta.url).href}'`,
  );
  source = source.replaceAll(
    "from './spoken-punctuation'",
    `from '${new URL('../lib/spoken-punctuation.ts', import.meta.url).href}'`,
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
  );
}
await test('automatic phrase suggestions preserve words, quotes, numbers and punctuation', () => {
  const source =
    'Dr. Wong said, “We paid $12.50 for the tickets.”\n\nAlthough it rained, everyone enjoyed the school visit. Bring your notebook tomorrow!';
  for (const length of [4, 6, 8, 12]) {
    const result = phraseBreaks(source, length);
    assert.equal(result.replace(/\s+/g, ' '), source.replace(/\s+/g, ' '));
    assert.ok(
      dictationPhrases(result).every(
        (p) => p.text.split(/\s+/).length <= length + 2,
      ),
    );
  }
  assert.throws(() => phraseBreaks(source, 0));
});
await test('manual line boundaries retain exact source offsets and blank lines add no phrases', () => {
  const source = '  A clear morning,\r\n\r\n we walked to school. \n';
  const phrases = dictationPhrases(source);
  assert.deepEqual(
    phrases.map((p) => p.text),
    ['A clear morning,', 'we walked to school.'],
  );
  for (const p of phrases)
    assert.equal(source.slice(p.offset, p.offset + p.text.length), p.text);
  assert.match(passageError(''), /readable text/);
  assert.match(passageError('x'.repeat(20001)), /20,000/);
});
await test('PDF runs within words stay joined; actual layout gaps create spaces', () => {
  const item = (str, x, width, hasEOL = false, y = 100) => ({
    str,
    transform: [12, 0, 0, 12, x, y],
    width,
    height: 12,
    hasEOL,
  });
  assert.equal(
    pdfPageText([
      item('Dicta', 0, 25),
      item('tion', 25, 20),
      item('passage.', 49, 40, true),
      item('Next line.', 0, 50, false, 80),
    ]),
    'Dictation passage.\nNext line.',
  );
});

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
  createBuffer(channels, length, rate) {
    return { duration: length / rate, copyToChannel() {} };
  }
  createBufferSource() {
    const context = this;
    return {
      buffer: null,
      connect() {},
      disconnect() {},
      stop() {},
      start(when) {
        context.starts.push({ when, duration: this.buffer.duration });
      },
    };
  }
}
const { NeuralPlayer } = await loadBrowserModule('../lib/neural-player.ts');
const phraseSource = (pause, count = 2) =>
  async function* () {
    for (let i = 0; i < count; i++)
      yield {
        type: 'audio',
        index: i,
        audio: new Float32Array(24000).fill(0.1),
        samples: 24000,
        sampleRate: 24000,
        channels: 1,
        offset: i * 6,
        end: i * 6 + 5,
        pauseAfter: pause,
        phrase: i + 1,
        count,
        readPunctuation: false,
      };
  };
await test('neural gaps are exact, pausable, include the final phrase, and cancel cleanly', async () => {
  const oldContext = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  try {
    for (const pause of [3, 8, 30]) {
      let state, position;
      const player = new NeuralPlayer(
        (s) => (state = s),
        () => {},
        (p) => (position = p),
        phraseSource(pause),
      );
      const playing = player.play('First\nFinal', 'af_heart', 1, {
        dictationPause: pause,
      });
      await wait();
      const context = FakeContext.latest;
      assert.equal(context.starts.length, 2);
      assert.ok(
        Math.abs(context.starts[1].when - context.starts[0].when - 1 - pause) <
          1e-8,
      );
      context.advance(context.starts[0].when + 1.4);
      await wait();
      assert.equal(state, 'writing');
      const remaining = position.remaining;
      await player.togglePause();
      context.advance(60);
      await wait();
      assert.equal(state, 'paused');
      assert.equal(position.remaining, remaining);
      await player.togglePause();
      context.advance(pause + 1);
      await wait();
      assert.equal(state, 'writing');
      assert.equal(position.phrase, 2);
      context.advance(pause);
      await wait();
      assert.equal(state, 'idle');
      assert.equal(context.state, 'closed');
      await playing;
    }
  } finally {
    globalThis.AudioContext = oldContext;
  }
});
await test('stopping a neural writing gap closes its clock and cannot start later phrases', async () => {
  const oldContext = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  try {
    let state;
    const player = new NeuralPlayer(
      (s) => (state = s),
      () => {},
      () => {},
      phraseSource(8, 1),
    );
    await player.play('First', 'af_heart', 1, { dictationPause: 8 });
    const context = FakeContext.latest;
    context.advance(2);
    await wait();
    assert.equal(state, 'writing');
    player.stop();
    context.advance(60);
    await wait();
    assert.equal(context.state, 'closed');
    assert.equal(state, 'writing');
  } finally {
    globalThis.AudioContext = oldContext;
  }
});
const { SystemDictationPlayer } = await loadClass(
  '../lib/system-dictation-player.ts',
);
await test('installed voice pause/end race resumes the native engine and preserves final writing time', () => {
  const oldWindow = globalThis.window,
    oldUtterance = globalThis.SpeechSynthesisUtterance,
    oldPerformance = globalThis.performance;
  let now = 0;
  globalThis.performance = { now: () => now };
  const callbacks = [];
  const originalInterval = globalThis.setInterval,
    originalClear = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    callbacks.push(fn);
    return fn;
  };
  globalThis.clearInterval = () => {};
  const synth = {
    paused: false,
    spoken: [],
    speak(u) {
      assert.equal(this.paused, false);
      this.spoken.push(u);
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    cancel() {},
  };
  globalThis.window = { speechSynthesis: synth };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  try {
    let state;
    const player = new SystemDictationPlayer(
      { lang: 'en-US' },
      (s) => (state = s),
      () => {},
      () => {},
      (message) => {
        throw new Error(message);
      },
    );
    player.play('First.\nFinal.', 1, 3);
    player.togglePause();
    synth.spoken[0].onend();
    now = 10000;
    player.togglePause();
    assert.equal(synth.paused, false);
    assert.equal(state, 'writing');
    now += 3001;
    callbacks.at(-1)();
    assert.equal(synth.spoken.length, 2);
    synth.spoken[1].onend();
    assert.equal(state, 'writing');
    now += 2999;
    callbacks.at(-1)();
    assert.equal(state, 'writing');
    now += 2;
    callbacks.at(-1)();
    assert.equal(state, 'idle');
    player.stop();
  } finally {
    globalThis.window = oldWindow;
    globalThis.SpeechSynthesisUtterance = oldUtterance;
    globalThis.performance = oldPerformance;
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
  }
});

await test('installed dictation names punctuation only when enabled and keeps source progress bounded', () => {
  const oldWindow = globalThis.window;
  const oldUtterance = globalThis.SpeechSynthesisUtterance;
  const spoken = [];
  globalThis.window = {
    speechSynthesis: {
      speak: (utterance) => spoken.push(utterance),
      cancel() {},
      resume() {},
    },
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  try {
    for (const option of [undefined, false, true]) {
      let progress = 0;
      const player = new SystemDictationPlayer(
        { lang: 'en-GB' },
        () => {},
        (p) => (progress = p),
        () => {},
        (message) => assert.fail(message),
      );
      try {
        player.play('Hello, class.\nNext phrase.', 1, 8, option);
        const utterance = spoken.at(-1);
        assert.equal(utterance.text, option ? 'Hello' : 'Hello, class.');
        utterance.onstart();
        utterance.onboundary({ charIndex: utterance.text.length + 100 });
        assert.equal(
          progress,
          (option ? 'Hello'.length : 'Hello, class.'.length) /
            'Hello, class.\nNext phrase.'.length,
        );
        utterance.onend();
        assert.ok(progress < 1);
      } finally {
        player.stop();
      }
    }
  } finally {
    globalThis.window = oldWindow;
    globalThis.SpeechSynthesisUtterance = oldUtterance;
  }
});

await test('neural dictation forwards punctuation and rejects a source that ignores it', async () => {
  const oldContext = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  try {
    for (const acknowledged of [false, true]) {
      const source = async function* (request) {
        assert.equal(request.readPunctuation, true);
        yield {
          type: 'audio',
          index: 0,
          audio: new Float32Array([0.1]),
          samples: 1,
          sampleRate: 24000,
          channels: 1,
          offset: 0,
          end: 6,
          phrase: 1,
          count: 1,
          pauseAfter: 3,
          readPunctuation: acknowledged,
        };
      };
      const player = new NeuralPlayer(
        () => {},
        () => {},
        () => {},
        source,
      );
      try {
        const result = player.play('Hello.', 'af_heart', 1, {
          dictationPause: 3,
          readPunctuation: true,
        });
        if (acknowledged) {
          await result;
          assert.equal(FakeContext.latest.starts.length, 1);
        } else {
          await assert.rejects(result, /incomplete or invalid/);
          assert.equal(FakeContext.latest.starts.length, 0);
        }
      } finally {
        player.stop();
      }
    }
  } finally {
    globalThis.AudioContext = oldContext;
  }
});
