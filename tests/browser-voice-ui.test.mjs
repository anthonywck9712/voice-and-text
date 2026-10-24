import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableEnglishVoices,
  neuralVoiceRequestId,
} from '../lib/voice-options.ts';
import { voiceModelState } from '../lib/voice-model-state.ts';

function installed(name, lang, localService = true, voiceURI = name) {
  return { name, lang, localService, voiceURI, default: false };
}

await test('the browser menu exposes 38 free model voices without needing installed system voices', () => {
  const voices = availableEnglishVoices();
  assert.equal(voices.length, 38);
  assert.equal(new Set(voices.map((voice) => voice.voiceURI)).size, 38);
  assert.equal(voices.filter((voice) => voice.engine === 'Kokoro').length, 28);
  assert.equal(
    voices.filter((voice) => voice.engine === 'Supertonic').length,
    10,
  );
  assert.ok(voices.every((voice) => !voice.systemVoice));
  assert.equal(
    voices.filter((voice) => voice.lang === 'en-HK' || voice.lang === 'en-SG')
      .length,
    0,
  );
});

await test('only a published free voice can route to browser neural inference', () => {
  for (const voice of availableEnglishVoices()) {
    assert.equal(neuralVoiceRequestId(voice.voiceURI), voice.voiceURI.slice(7));
  }
  for (const value of [
    'azure:en-HK-YanNeural',
    'azure:en-SG-LunaNeural',
    'neural:unknown',
    'neural:supertonic:F6',
    'Samantha',
    '',
  ]) {
    assert.equal(neuralVoiceRequestId(value), null, value);
  }
});

await test('local Hong Kong and Singapore voices are retained while remote and non-English voices are excluded', () => {
  const hk = installed('Local Hong Kong', 'en_HK');
  const sg = installed('Local Singapore', 'en-SG');
  const voices = availableEnglishVoices([
    hk,
    sg,
    installed('Microsoft Online', 'en-HK', false),
    installed('French voice', 'fr-FR'),
    installed('Boing', 'en-US'),
    installed('Local Hong Kong', 'en-HK', true, 'duplicate'),
  ]);
  const system = voices.filter((voice) => voice.systemVoice);
  assert.equal(system.length, 2);
  assert.equal(system.find((voice) => voice.lang === 'en-HK').systemVoice, hk);
  assert.equal(system.find((voice) => voice.lang === 'en-SG').systemVoice, sg);
  for (const voice of system)
    assert.equal(neuralVoiceRequestId(voice.voiceURI), null);
});

const downloading = {
  stage: 'downloading',
  engine: 'kokoro',
  bytes: 20_000_000,
  total: 100_000_000,
  progress: 0.2,
  message: 'Downloading',
};

await test('active model download exposes real progress and never counts it as ready audio', () => {
  const view = voiceModelState(downloading, 'kokoro', true);
  assert.equal(view.busy, true);
  assert.equal(view.downloading, true);
  assert.equal(view.ready, false);
  assert.equal(view.bytes, 20_000_000);
  assert.equal(view.total, 100_000_000);
  assert.equal(view.progress, 0.2);
});

await test('unknown download progress and model initialization remain indeterminate', () => {
  const unknown = voiceModelState(
    { ...downloading, total: undefined, progress: undefined },
    'kokoro',
    true,
  );
  assert.equal(unknown.total, undefined);
  assert.equal(unknown.progress, undefined);
  const initializing = voiceModelState(
    { ...downloading, stage: 'initializing' },
    'kokoro',
    true,
  );
  assert.equal(initializing.busy, true);
  assert.equal(initializing.downloading, false);
  assert.equal(initializing.progress, undefined);
  assert.equal(initializing.ready, false);
});

await test('cancelled jobs and a different voice engine cannot display stale download activity', () => {
  for (const view of [
    voiceModelState(downloading, 'kokoro', false),
    voiceModelState(downloading, 'supertonic', true),
  ]) {
    assert.equal(view.busy, false);
    assert.equal(view.bytes, 0);
    assert.equal(view.progress, undefined);
    assert.equal(view.ready, false);
  }
});

await test('a loaded model stays ready while generating speech, but an error does not', () => {
  for (const stage of ['generating', 'ready']) {
    assert.equal(
      voiceModelState({ ...downloading, stage }, 'kokoro', true).ready,
      true,
    );
  }
  assert.equal(
    voiceModelState({ ...downloading, stage: 'error' }, 'kokoro', true).ready,
    false,
  );
  assert.equal(
    voiceModelState({ ...downloading, stage: 'ready' }, 'supertonic', false)
      .ready,
    false,
  );
});
