import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { KOKORO_VOICES } from '../lib/text.ts';

const require = createRequire(import.meta.url);
const { KokoroTTS } = require('kokoro-js');
// Reading metadata does not initialize a model or start inference.
const supportedVoices = Object.getOwnPropertyDescriptor(
  KokoroTTS.prototype,
  'voices',
).get.call(null);
const packageRoot = resolve(dirname(require.resolve('kokoro-js')), '..');

await test('every offered Kokoro voice matches the installed English voice catalog', () => {
  const supportedEnglishIds = Object.entries(supportedVoices)
    .filter(([, voice]) => /^en-(us|gb)$/u.test(voice.language))
    .map(([id]) => id)
    .sort();
  const offeredIds = KOKORO_VOICES.map((voice) =>
    voice.voiceURI.replace(/^neural:/u, ''),
  );
  assert.equal(new Set(offeredIds).size, offeredIds.length);
  assert.deepEqual([...offeredIds].sort(), supportedEnglishIds);
  for (const voice of KOKORO_VOICES) {
    assert.match(voice.voiceURI, /^neural:[ab][fm]_[a-z]+$/u);
    const supported = supportedVoices[voice.voiceURI.slice('neural:'.length)];
    assert.equal(voice.name, supported.name);
    assert.equal(voice.lang.toLowerCase(), supported.language);
    assert.equal(voice.character, `${supported.gender} voice`);
  }
});

await test('every offered Kokoro voice has its embedding bundled for offline inference', async () => {
  for (const voice of KOKORO_VOICES) {
    const id = voice.voiceURI.slice('neural:'.length);
    const file = await stat(resolve(packageRoot, 'voices', `${id}.bin`));
    assert.ok(file.isFile(), `${id}: missing bundled embedding`);
    assert.ok(file.size > 0, `${id}: empty bundled embedding`);
    // Kokoro reads each embedding as rows of 256 float32 values.
    assert.equal(file.size % (256 * Float32Array.BYTES_PER_ELEMENT), 0, id);
  }
});
