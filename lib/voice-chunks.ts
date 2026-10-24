import {
  dictationPhrases,
  MAX_PASSAGE_LENGTH,
  MAX_PHRASES,
  type ReadingOptions,
} from './dictation';
import { speechChunks } from './text';
import {
  coalesceSpokenChunks,
  dictationSpeechSegments,
  PUNCTUATION_PAUSE_SECONDS,
} from './spoken-punctuation';

export type VoiceRequest = ReadingOptions & {
  text: string;
  voice: string;
  speed: number;
};
export type VoiceChunk = {
  type: 'audio';
  index: number;
  audio: Float32Array<ArrayBuffer>;
  samples: number;
  sampleRate: number;
  channels: 1;
  offset: number;
  end: number;
  pauseAfter: number;
  phrase: number;
  count: number;
  readPunctuation: boolean;
};
export type VoiceEngine = {
  generate(
    text: string,
    options: { voice: string; speed: number },
  ): Promise<{ audio: Float32Array; sampling_rate: number }>;
};
export type VoiceSource = (
  request: VoiceRequest,
  signal: AbortSignal,
) => AsyncIterable<VoiceChunk>;

export function validateVoiceRequest(request: VoiceRequest) {
  const { text, voice, speed, dictationPause, readPunctuation } = request;
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > MAX_PASSAGE_LENGTH ||
    typeof voice !== 'string' ||
    !voice.trim() ||
    !Number.isFinite(speed) ||
    speed < 0.5 ||
    speed > 1.5
  )
    throw new Error(
      'Choose a voice and enter 1–20,000 characters at a supported speed.',
    );
  if (
    (readPunctuation !== undefined && typeof readPunctuation !== 'boolean') ||
    (readPunctuation && dictationPause === undefined)
  )
    throw new Error(
      'Spoken punctuation is available for dictation. Choose its setting and try again.',
    );
  if (
    dictationPause !== undefined &&
    (!Number.isInteger(dictationPause) ||
      dictationPause < 3 ||
      dictationPause > 30 ||
      dictationPhrases(text).length > MAX_PHRASES)
  )
    throw new Error(
      'Choose a writing pause of 3–30 seconds and use up to 400 phrases.',
    );
}

/** Identical source ranges and PCM timing for playback and file creation. */
export async function* generateVoiceChunks(
  engine: VoiceEngine,
  request: VoiceRequest,
  signal: AbortSignal,
): AsyncGenerator<VoiceChunk> {
  validateVoiceRequest(request);
  const {
    text,
    voice,
    speed,
    dictationPause,
    readPunctuation = false,
  } = request;
  const phrases = dictationPause === undefined ? [] : dictationPhrases(text);
  type Part = {
    text: string;
    offset: number;
    pauseAfter: number;
    phrase: number;
    count: number;
    spoken?: string;
    punctuation?: boolean;
  };
  const source: Part[] =
    dictationPause === undefined
      ? speechChunks(text, 300).map((chunk) => ({
          ...chunk,
          pauseAfter: 0,
          phrase: 0,
          count: 0,
        }))
      : phrases.map((chunk, i) => ({
          ...chunk,
          pauseAfter: dictationPause,
          phrase: i + 1,
          count: phrases.length,
        }));
  const expand = (part: Part): Part[] =>
    readPunctuation
      ? dictationSpeechSegments(
          text,
          part.offset,
          part.offset + part.text.length,
        ).map((segment, i, segments) => ({
          ...part,
          text: text.slice(segment.offset, segment.end),
          offset: segment.offset,
          spoken: segment.text,
          punctuation: segment.punctuation,
          pauseAfter: i === segments.length - 1 ? part.pauseAfter : 0,
        }))
      : [part];
  const pending = source
    .flatMap((part) =>
      speechChunks(part.text, 300).map((piece, i, pieces) => ({
        ...part,
        text: piece.text,
        offset: part.offset + piece.offset,
        pauseAfter: i === pieces.length - 1 ? part.pauseAfter : 0,
      })),
    )
    .flatMap(expand);
  // Cache only fixed punctuation labels, within this job; never store passage text.
  const cues = new Map<
    string,
    { audio: Float32Array; sampling_rate: number }
  >();
  let cueBytes = 0;
  let index = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const chunk = pending.shift()!;
    let result;
    try {
      result = chunk.punctuation ? cues.get(chunk.spoken!) : undefined;
      if (!result) {
        result = await engine.generate(chunk.spoken ?? chunk.text, {
          voice,
          speed,
        });
        if (
          !result.audio?.length ||
          !result.audio.every(Number.isFinite) ||
          ![24000, 44100, 48000].includes(result.sampling_rate)
        )
          throw new Error(
            'The voice produced invalid audio. Try another voice.',
          );
        if (
          chunk.punctuation &&
          cueBytes + result.audio.byteLength < 4 * 1024 * 1024
        ) {
          cues.set(chunk.spoken!, result);
          cueBytes += result.audio.byteLength;
        }
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'VOICE_INPUT_TOO_LONG' ||
        chunk.text.length < 2
      )
        throw error;
      let limit = Math.max(1, Math.floor(chunk.text.length / 2));
      let parts: Part[];
      while (true) {
        const split = speechChunks(chunk.text, limit);
        parts = split.map((part, i) => ({
          ...chunk,
          text: part.text,
          offset: chunk.offset + part.offset,
          pauseAfter: i === split.length - 1 ? chunk.pauseAfter : 0,
        }));
        if (readPunctuation) parts = coalesceSpokenChunks(text, parts);
        if (parts.length > 1) break;
        if (limit === 1) throw error;
        limit = Math.max(1, Math.floor(limit / 2));
      }
      pending.unshift(...parts.flatMap(expand));
      continue;
    }
    signal.throwIfAborted();
    const silence = chunk.punctuation
      ? Math.round(PUNCTUATION_PAUSE_SECONDS * result.sampling_rate)
      : 0;
    // Own the buffer: transfer must not detach the punctuation cache or model tensors.
    const audio = new Float32Array(silence + result.audio.length);
    audio.set(result.audio, silence);
    yield {
      type: 'audio',
      index: index++,
      offset: chunk.offset,
      end: chunk.offset + chunk.text.length,
      sampleRate: result.sampling_rate,
      samples: audio.length,
      channels: 1,
      audio,
      pauseAfter: chunk.pauseAfter,
      phrase: chunk.phrase,
      count: chunk.count,
      readPunctuation,
    };
  }
}

/** Reject incomplete or out-of-order output before it can be played or downloaded. */
export class VoiceChunkValidator {
  private previousEnd = 0;
  private index = 0;
  private phraseIndex = 0;
  private rate = 0;
  private phrases;
  constructor(private request: VoiceRequest) {
    validateVoiceRequest(request);
    this.phrases =
      request.dictationPause === undefined
        ? []
        : dictationPhrases(request.text);
  }
  accept(chunk: VoiceChunk) {
    const { text, dictationPause, readPunctuation } = this.request;
    const invalid = () => {
      throw new Error('The audio was incomplete or invalid. Please try again.');
    };
    if (
      !chunk ||
      chunk.type !== 'audio' ||
      chunk.index !== this.index ||
      ![24000, 44100, 48000].includes(chunk.sampleRate) ||
      (this.rate && this.rate !== chunk.sampleRate) ||
      chunk.channels !== 1 ||
      !(chunk.audio instanceof Float32Array) ||
      !chunk.audio.length ||
      chunk.audio.length !== chunk.samples ||
      !chunk.audio.every(Number.isFinite) ||
      !Number.isSafeInteger(chunk.offset) ||
      !Number.isSafeInteger(chunk.end) ||
      chunk.offset < this.previousEnd ||
      chunk.end <= chunk.offset ||
      chunk.end > text.length ||
      text.slice(this.previousEnd, chunk.offset).trim() ||
      !text.slice(chunk.offset, chunk.end).trim()
    )
      invalid();
    if (readPunctuation && chunk.readPunctuation !== true) invalid();
    if (dictationPause !== undefined) {
      const phrase = this.phrases[this.phraseIndex];
      const end = phrase && phrase.offset + phrase.text.length;
      if (
        !phrase ||
        chunk.phrase !== this.phraseIndex + 1 ||
        chunk.count !== this.phrases.length ||
        chunk.offset < phrase.offset ||
        chunk.end > end ||
        chunk.pauseAfter !== (chunk.end === end ? dictationPause : 0)
      )
        throw new Error(
          'The dictation audio had missing or incorrect writing pauses. Please try again.',
        );
      if (chunk.end === end) this.phraseIndex++;
    } else if (chunk.pauseAfter || chunk.phrase || chunk.count) invalid();
    this.rate = chunk.sampleRate;
    this.previousEnd = chunk.end;
    this.index++;
  }
  complete() {
    if (
      !this.index ||
      this.request.text.slice(this.previousEnd).trim() ||
      (this.request.dictationPause !== undefined &&
        this.phraseIndex !== this.phrases.length)
    )
      throw new Error('The audio was incomplete or invalid. Please try again.');
  }
}
