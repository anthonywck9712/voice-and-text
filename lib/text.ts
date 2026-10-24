import { SUPERTONIC_VOICES } from './supertonic-model.ts';

export const SAMPLE_TEXT =
  'A little practice, every day, can make a remarkable difference. Read something that interests you. Listen to the rhythm of each sentence, and give yourself time to find your own voice.\n\nYou do not have to get every word perfect. Start with curiosity, keep going, and enjoy what you discover along the way.';
export function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
export function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
// Group whole sentences for context; split an oversized sentence at a clause first.
// Offsets always refer to the unmodified editor text, including whitespace.
export function speechChunks(text: string, limit = 450) {
  if (limit < 1) throw new Error('Chunk limit must be positive');
  const result: { text: string; offset: number }[] = [];
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const push = (start: number, end: number) => {
    const raw = text.slice(start, end);
    if (raw.trim())
      result.push({
        text: raw.trim(),
        offset: start + raw.length - raw.trimStart().length,
      });
  };
  for (const paragraph of text.matchAll(/\S[\s\S]*?(?=\r?\n[ \t]*\r?\n|$)/gu)) {
    let start = paragraph.index!;
    let end = start;
    for (const sentence of segmenter.segment(paragraph[0])) {
      const sentenceStart = paragraph.index! + sentence.index;
      const sentenceEnd = sentenceStart + sentence.segment.length;
      if (sentenceEnd - start > limit && end > start) {
        push(start, end);
        start = sentenceStart;
      }
      while (sentenceEnd - start > limit) {
        const window = text.slice(start, start + limit);
        const clause = [...window.matchAll(/[,;:—](?:\s|$)/gu)].at(-1);
        const space = window.lastIndexOf(' ');
        const cut =
          clause && clause.index! > limit / 3
            ? clause.index! + 1
            : space > 0
              ? space
              : limit;
        push(start, start + cut);
        start += cut;
        while (start < sentenceEnd && /\s/u.test(text[start])) start++;
      }
      end = sentenceEnd;
    }
    push(start, end);
  }
  return result;
}

// English voices bundled with kokoro-js. Keep the browser catalog independent of
// the inference package so importing this list does not load the model client-side.
// Source: https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
export const KOKORO_VOICES = [
  {
    voiceURI: 'neural:af_heart',
    name: 'Heart',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_bella',
    name: 'Bella',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_alloy',
    name: 'Alloy',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_aoede',
    name: 'Aoede',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_jessica',
    name: 'Jessica',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_kore',
    name: 'Kore',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_nicole',
    name: 'Nicole',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_nova',
    name: 'Nova',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_river',
    name: 'River',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_sarah',
    name: 'Sarah',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:af_sky',
    name: 'Sky',
    lang: 'en-US',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:am_adam',
    name: 'Adam',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:am_echo',
    name: 'Echo',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:am_eric',
    name: 'Eric',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:am_fenrir',
    name: 'Fenrir',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:am_liam',
    name: 'Liam',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:am_michael',
    name: 'Michael',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:am_onyx',
    name: 'Onyx',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:am_puck',
    name: 'Puck',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:am_santa',
    name: 'Santa',
    lang: 'en-US',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:bf_emma',
    name: 'Emma',
    lang: 'en-GB',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:bf_alice',
    name: 'Alice',
    lang: 'en-GB',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:bf_isabella',
    name: 'Isabella',
    lang: 'en-GB',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:bf_lily',
    name: 'Lily',
    lang: 'en-GB',
    character: 'Female voice',
  },
  {
    voiceURI: 'neural:bm_daniel',
    name: 'Daniel',
    lang: 'en-GB',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:bm_fable',
    name: 'Fable',
    lang: 'en-GB',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:bm_george',
    name: 'George',
    lang: 'en-GB',
    character: 'Male voice',
  },
  {
    voiceURI: 'neural:bm_lewis',
    name: 'Lewis',
    lang: 'en-GB',
    character: 'Male voice',
  },
].map((voice) => ({ ...voice, engine: 'Kokoro' }));

export const NEURAL_VOICES = [...KOKORO_VOICES, ...SUPERTONIC_VOICES];
const ACCENTS: Record<string, string> = {
  'en-us': 'American',
  'en-gb': 'British',
  'en-au': 'Australian',
  'en-ca': 'Canadian',
  'en-ie': 'Irish',
  'en-in': 'Indian',
  'en-nz': 'New Zealand',
  'en-za': 'South African',
  'en-hk': 'Hong Kong',
  'en-sg': 'Singaporean',
  'en-scotland': 'Scottish',
  en: 'English',
};
export function accentName(lang: string) {
  return (
    ACCENTS[lang.toLowerCase().replaceAll('_', '-')] || `English (${lang})`
  );
}
export function localEnglishVoices(voices: SpeechSynthesisVoice[]) {
  const novelty =
    /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Fred|Good News|Jester|Junior|Kathy|Organ|Superstar|Ralph|Trinoids|Whisper|Zarvox|Grandma|Grandpa)(?:\b|$)/i;
  const quality = (name: string) =>
    /premium/i.test(name)
      ? 4
      : /enhanced|natural/i.test(name)
        ? 3
        : /Ava|Samantha|Daniel|Karen|Moira|Tessa|Rishi/i.test(name)
          ? 2
          : 1;
  const seen = new Set<string>();
  return voices
    .filter((v) => {
      const key = `${v.name}|${v.lang.toLowerCase().replaceAll('_', '-')}`;
      if (
        !/^en(?:[-_]|$)/i.test(v.lang) ||
        !v.localService ||
        novelty.test(v.name) ||
        seen.has(key)
      )
        return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        quality(b.name) - quality(a.name) ||
        accentName(a.lang).localeCompare(accentName(b.lang)) ||
        a.name.localeCompare(b.name),
    );
}
