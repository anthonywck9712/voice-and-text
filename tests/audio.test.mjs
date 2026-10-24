import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTranscript,
  joinAudio,
  resampleMono,
  rms,
  SpeechSegmenter,
  microphoneError,
} from '../lib/audio.ts';
import {
  speechChunks,
  wordCount,
  localEnglishVoices,
  formatTime,
} from '../lib/text.ts';
const voice = (n = 3200) => new Float32Array(n).fill(0.1);
const silence = (n = 3200) => new Float32Array(n);
await test('48kHz and 44.1kHz frames become correct 16kHz lengths', () => {
  for (const rate of [48000, 44100, 16000]) {
    const out = resampleMono(new Float32Array(rate).fill(0.2), rate);
    assert.equal(out.length, 16000);
    assert.ok(Math.abs(rms(out) - 0.2) < 0.0001);
  }
});
await test('empty PCM and invalid rates are handled', () => {
  assert.equal(rms(silence()), 0);
  assert.equal(resampleMono(new Float32Array(0), 44100).length, 0);
  assert.throws(() => resampleMono(voice(), 0));
});
await test('silence alone is never sent for inference', () => {
  const s = new SpeechSegmenter();
  for (let i = 0; i < 100; i++) assert.equal(s.feed(silence()), null);
  assert.equal(s.flush(), null);
});
await test('pause finalizes speech and preserves short trailing utterance on Stop', () => {
  const s = new SpeechSegmenter();
  s.feed(silence());
  s.feed(voice());
  s.feed(voice());
  let out;
  for (let i = 0; i < 4; i++) out = s.feed(silence());
  assert.ok(out?.audio.length);
  assert.equal(out.overlap, false);
  s.feed(voice());
  assert.ok(s.flush()?.audio.length);
  assert.equal(s.flush(), null);
});
await test('forced window preserves new speech shorter than 150ms on Stop', () => {
  const s = new SpeechSegmenter();
  let out;
  for (let i = 0; i < 30; i++) out = s.feed(voice());
  assert.equal(out.audio.length, 96000);
  s.feed(voice(1600));
  const last = s.flush();
  assert.equal(last.audio.length, 9600);
  assert.equal(last.overlap, true);
});
await test('forced window never repeats its retained tail without new speech', () => {
  const s = new SpeechSegmenter();
  for (let i = 0; i < 30; i++) s.feed(voice());
  assert.equal(s.flush(), null);
});
await test('forced windows cover every input sample with explicit overlap', () => {
  const s = new SpeechSegmenter();
  const outputs = [];
  for (let i = 0; i < 100; i++) {
    const out = s.feed(voice());
    if (out) outputs.push(out);
  }
  const tail = s.flush();
  if (tail) outputs.push(tail);
  assert.equal(
    outputs.reduce((n, o) => n + o.audio.length - (o.overlap ? 8000 : 0), 0),
    320000,
  );
});
await test('overlap merges boundary words without duplicating them', () => {
  assert.equal(
    appendTranscript(
      'Bring your green pencil.',
      'Green pencil, and a notebook.',
      true,
    ),
    'Bring your green pencil. and a notebook.',
  );
});
await test('separate utterances preserve deliberate repetition', () => {
  assert.equal(appendTranscript('Yes.', 'Yes.', false), 'Yes.\n\nYes.');
  assert.equal(appendTranscript('Saved text', '  '), 'Saved text');
});
await test('speech chunk offsets preserve punctuation and original text', () => {
  const input =
    '  ' + 'Take your time. Read clearly and listen carefully. '.repeat(100);
  for (const chunk of speechChunks(input)) {
    assert.equal(
      input.slice(chunk.offset, chunk.offset + chunk.text.length),
      chunk.text,
    );
    assert.ok(chunk.text.length <= 450);
  }
  assert.equal(
    speechChunks(input)
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    input.trim(),
  );
});
await test('empty input and long unbroken text do not stall the speaker', () => {
  assert.deepEqual(speechChunks('   '), []);
  assert.equal(
    speechChunks('x'.repeat(1000))
      .map((c) => c.text)
      .join(''),
    'x'.repeat(1000),
  );
  assert.throws(() => speechChunks('x', 0));
});
await test('voice choices exclude remote services and other languages', () => {
  const voices = [
    { name: 'Local US', lang: 'en_US', localService: true },
    { name: 'Remote GB', lang: 'en-GB', localService: false },
    { name: 'Local FR', lang: 'fr-FR', localService: true },
  ];
  assert.deepEqual(
    localEnglishVoices(voices).map((v) => v.name),
    ['Local US'],
  );
});
await test('permission errors give actionable recovery', () => {
  assert.match(microphoneError({ name: 'NotAllowedError' }), /Allow/);
  assert.match(microphoneError({ name: 'NotFoundError' }), /Connect/);
  assert.match(microphoneError({ name: 'NotReadableError' }), /other apps/);
});
await test('text utilities and PCM concatenation preserve data', () => {
  assert.equal(wordCount('  one\n two three '), 3);
  assert.equal(formatTime(125), '2:05');
  assert.deepEqual(
    [...joinAudio([new Float32Array([1, 2]), new Float32Array([3])])],
    [1, 2, 3],
  );
});
await test('natural phrasing preserves sentences, decimals, quotes and paragraph boundaries', () => {
  const input =
    'Dr. Wong arrived at 9.30 a.m. He paid $12.50. “Really?” she asked.\n\nWell, yes, I think so. But are you sure? Let’s check.';
  const chunks = speechChunks(input);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, input.split('\n\n')[0]);
  assert.equal(chunks[1].text, input.split('\n\n')[1]);
  const sentence =
    'While we waited, ' +
    'the children read quietly and listened carefully '.repeat(6) +
    'until it was time to go.';
  assert.equal(speechChunks(sentence).length, 1);
  for (const limit of [1, 2, 7, 20, 50, 450]) {
    const rebuilt = speechChunks(input, limit)
      .map((c) => c.text)
      .join('')
      .replace(/\s/g, '');
    assert.equal(rebuilt, input.replace(/\s/g, ''));
  }
});
await test('voice selection removes novelty voices and prefers enhanced voices over alphabetical names', () => {
  const names = [
    'Albert',
    'Zarvox',
    'Bahh',
    'Samantha',
    'Ava (Enhanced)',
    'Daniel',
  ];
  const result = localEnglishVoices(
    names.map((name) => ({ name, lang: 'en-US', localService: true })),
  );
  assert.equal(result[0].name, 'Ava (Enhanced)');
  assert.deepEqual(
    new Set(result.map((v) => v.name)),
    new Set(['Ava (Enhanced)', 'Samantha', 'Daniel']),
  );
});
