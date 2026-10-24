import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NEURAL_VOICES, KOKORO_VOICES } from '../lib/text.ts';
import {
  SUPERTONIC_VOICES,
  SUPERTONIC_VOICE_IDS,
  SUPERTONIC_MODEL_URL,
  SUPERTONIC_DOWNLOAD_BYTES,
  SUPERTONIC_SAMPLE_RATE,
  supertonicVoiceId,
  normalizeSupertonicText,
} from '../lib/supertonic-model.ts';

await test('additional speakers are the ten archived official presets, with no invented accents', () => {
  assert.deepEqual(
    [...SUPERTONIC_VOICE_IDS],
    ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'],
  );
  assert.equal(KOKORO_VOICES.length, 28);
  assert.equal(NEURAL_VOICES.length, 38);
  assert.equal(new Set(NEURAL_VOICES.map((v) => v.voiceURI)).size, 38);
  for (const voice of SUPERTONIC_VOICES) {
    assert.equal(voice.lang, 'en');
    assert.equal(voice.engine, 'Supertonic');
    assert.equal(
      supertonicVoiceId(voice.voiceURI),
      voice.name.replace('Supertonic ', ''),
    );
  }
  assert.match(
    SUPERTONIC_MODEL_URL,
    /\/aafc6e32416a594460b32413efc49d7fe4ce6d46$/u,
  );
  assert.equal(SUPERTONIC_DOWNLOAD_BYTES, 398075273);
  assert.equal(SUPERTONIC_SAMPLE_RATE, 44100);
});

await test('voice validation cannot select unknown presets or interpolate arbitrary download paths', () => {
  assert.equal(supertonicVoiceId('F1'), 'F1');
  assert.equal(supertonicVoiceId('supertonic:M5'), 'M5');
  for (const id of ['af_heart', '../../other', 'F6', 'M0', '']) {
    assert.throws(() => supertonicVoiceId(id), /available Supertonic voices/u);
  }
});

await test('English normalization retains sentence punctuation and produces model language tags', () => {
  assert.equal(
    normalizeSupertonicText('Hello, class!'),
    '<en>Hello, class!</en>',
  );
  assert.equal(
    normalizeSupertonicText('  Please\nwrite this  '),
    '<en>Please write this.</en>',
  );
  assert.equal(
    normalizeSupertonicText('“We’re ready,” she said.'),
    '<en>"We\'re ready," she said.</en>',
  );
  assert.equal(normalizeSupertonicText('😀 Hello'), '<en>Hello.</en>');
  assert.equal(
    normalizeSupertonicText('e.g., apples'),
    '<en>for example, apples.</en>',
  );
  assert.throws(() => normalizeSupertonicText('😀   '), /English text/u);
});

await test('model redistribution includes the complete model restrictions and code attribution', async () => {
  const model = await readFile(
    new URL('../public/licenses/supertonic-model.txt', import.meta.url),
    'utf8',
  );
  const code = await readFile(
    new URL('../public/licenses/supertonic-code.txt', import.meta.url),
    'utf8',
  );
  assert.match(model, /BigScience Open RAIL-M License/u);
  assert.match(model, /Attachment A/u);
  assert.match(model, /You shall require all of Your users/u);
  assert.match(code, /Copyright \(c\) 2025 Supertone Inc\./u);
});
