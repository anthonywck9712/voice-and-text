// Official archived model and preset identities. Pin downloads for reproducibility.
// https://github.com/supertone-oss-archive/supertonic
export const SUPERTONIC_MODEL_REVISION =
  'aafc6e32416a594460b32413efc49d7fe4ce6d46';
export const SUPERTONIC_MODEL_URL = `https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/${SUPERTONIC_MODEL_REVISION}`;
export const SUPERTONIC_VOICE_IDS = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
] as const;
export type SupertonicVoice = (typeof SUPERTONIC_VOICE_IDS)[number];
export const SUPERTONIC_SAMPLE_RATE = 44100;
export const SUPERTONIC_MODEL_FILES = [
  { name: 'duration_predictor', bytes: 3700147 },
  { name: 'text_encoder', bytes: 36416150 },
  { name: 'vector_estimator', bytes: 256534781 },
  { name: 'vocoder', bytes: 101424195 },
] as const;
export const SUPERTONIC_DOWNLOAD_BYTES = SUPERTONIC_MODEL_FILES.reduce(
  (total, file) => total + file.bytes,
  0,
);

export const SUPERTONIC_VOICES = SUPERTONIC_VOICE_IDS.map((id) => ({
  voiceURI: `neural:supertonic:${id}`,
  name: `Supertonic ${id}`,
  // Presets support English; the publisher does not assign regional accents.
  lang: 'en',
  character: `${id.startsWith('F') ? 'Female' : 'Male'} voice`,
  engine: 'Supertonic',
}));

export function supertonicVoiceId(value: string): SupertonicVoice {
  const id = value.replace(/^neural:/u, '').replace(/^supertonic:/u, '');
  if (!SUPERTONIC_VOICE_IDS.includes(id as SupertonicVoice)) {
    throw new Error('Choose one of the available Supertonic voices.');
  }
  return id as SupertonicVoice;
}

// Adapted from the MIT-licensed official web/helper.js (see THIRD_PARTY_NOTICES.md).
// Keep phonetic normalization aligned with the model's Unicode tokenizer.
export function normalizeSupertonicText(input: string) {
  let text = input
    .normalize('NFKD')
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
      '',
    );
  for (const [from, to] of Object.entries({
    '–': '-',
    '‑': '-',
    '—': '-',
    _: ' ',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
    '´': "'",
    '`': "'",
    '[': ' ',
    ']': ' ',
    '|': ' ',
    '/': ' ',
    '#': ' ',
    '→': ' ',
    '←': ' ',
    '@': ' at ',
    'e.g.,': 'for example, ',
    'i.e.,': 'that is, ',
  }))
    text = text.replaceAll(from, to);
  text = text
    .replace(/[♥☆♡©\\]/gu, '')
    .replace(/ ([,.!?;:'])/gu, '$1')
    .replace(/"{2,}/gu, '"')
    .replace(/'{2,}/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) throw new Error('Enter some English text to read.');
  if (!/[.!?;:,'")\]}…。 」』】〉》›»]$/u.test(text)) text += '.';
  return `<en>${text}</en>`;
}
