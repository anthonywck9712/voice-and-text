import { dictationPhrases } from './dictation';
import {
  dictationSpeechSegments,
  PUNCTUATION_PAUSE_SECONDS,
} from './spoken-punctuation';
import type { DictationSpeechSegment } from './spoken-punctuation';
import type { PhrasePosition } from './dictation';
import type { ReadingStatus } from './neural-player';

/** Native speech and both kinds of silence share one pausable phrase timeline. */
export class SystemDictationPlayer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private gapTimer: ReturnType<typeof setInterval> | undefined;
  private utterance: SpeechSynthesisUtterance | null = null;
  private stopped = false;
  private paused = false;
  private gap: 'writing' | 'punctuation' | null = null;
  private gapRemaining = 0;
  private deadline = 0;
  private index = 0;
  private segmentIndex = 0;
  private segments: DictationSpeechSegment[] = [];
  private phrases: ReturnType<typeof dictationPhrases> = [];
  private total = 1;
  private rate = 1;
  private pauseSeconds = 8;
  private started = false;
  private originalText = '';
  private readPunctuation = false;
  constructor(
    private voice: SpeechSynthesisVoice,
    private onStatus: (value: ReadingStatus) => void,
    private onProgress: (value: number) => void,
    private onPosition: (value: PhrasePosition) => void,
    private onError: (message: string) => void,
  ) {}
  play(
    text: string,
    rate: number,
    pauseSeconds: number,
    readPunctuation = false,
  ) {
    this.originalText = text;
    this.readPunctuation = readPunctuation;
    this.phrases = dictationPhrases(text);
    this.total = text.length;
    this.rate = rate;
    this.pauseSeconds = pauseSeconds;
    this.readNext();
  }
  private watchStart() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.stopped && !this.paused)
        this.onError(
          'The installed voice did not start. Choose another voice and try again.',
        );
    }, 12000);
  }
  private readNext() {
    if (this.stopped) return;
    const phrase = this.phrases[this.index];
    if (!phrase) {
      this.onProgress(1);
      this.onStatus('idle');
      this.stop();
      return;
    }
    this.onPosition({
      phrase: this.index + 1,
      count: this.phrases.length,
      remaining: 0,
    });
    this.segments = this.readPunctuation
      ? dictationSpeechSegments(
          this.originalText,
          phrase.offset,
          phrase.offset + phrase.text.length,
        )
      : [
          {
            ...phrase,
            end: phrase.offset + phrase.text.length,
            punctuation: false,
          },
        ];
    this.segmentIndex = 0;
    this.readSegment();
  }
  private readSegment(afterPunctuationPause = false) {
    if (this.stopped) return;
    const segment = this.segments[this.segmentIndex];
    if (!segment) {
      const phrase = this.phrases[this.index];
      this.onProgress((phrase.offset + phrase.text.length) / this.total);
      this.beginGap('writing', this.pauseSeconds);
      return;
    }
    if (segment.punctuation && !afterPunctuationPause) {
      this.beginGap('punctuation', PUNCTUATION_PAUSE_SECONDS);
      return;
    }
    this.onStatus(this.paused ? 'paused' : 'speaking');
    this.started = false;
    const utterance = new SpeechSynthesisUtterance(segment.text);
    this.utterance = utterance;
    utterance.voice = this.voice;
    utterance.lang = this.voice.lang;
    utterance.rate = this.rate;
    utterance.onstart = () => {
      if (!this.stopped) {
        this.started = true;
        clearTimeout(this.timer);
      }
    };
    utterance.onboundary = (e) => {
      if (!this.stopped) {
        const fraction = Math.min(
          1,
          Math.max(0, e.charIndex / segment.text.length),
        );
        this.onProgress(
          (segment.offset + fraction * (segment.end - segment.offset)) /
            this.total,
        );
      }
    };
    utterance.onend = () => {
      if (this.stopped) return;
      clearTimeout(this.timer);
      this.utterance = null;
      this.onProgress(segment.end / this.total);
      this.segmentIndex++;
      // An end event can race with Pause. Wait until Resume before issuing the
      // next utterance, but retain the entire next silence if there is one.
      const next = this.segments[this.segmentIndex];
      if (!this.paused || !next || next.punctuation) this.readSegment();
    };
    utterance.onerror = (e) => {
      if (!this.stopped && !['canceled', 'interrupted'].includes(e.error))
        this.onError(
          'This voice could not read the phrase. Choose another voice and try again.',
        );
    };
    this.watchStart();
    window.speechSynthesis.speak(utterance);
  }
  private beginGap(kind: 'writing' | 'punctuation', seconds: number) {
    clearInterval(this.gapTimer);
    this.gap = kind;
    this.gapRemaining = seconds;
    this.deadline = performance.now() + seconds * 1000;
    this.tickGap();
    this.gapTimer = setInterval(
      () => this.tickGap(),
      kind === 'punctuation' ? 10 : 100,
    );
  }
  private tickGap() {
    if (this.stopped || this.paused || !this.gap) return;
    this.gapRemaining = Math.max(0, (this.deadline - performance.now()) / 1000);
    if (!this.gapRemaining) {
      clearInterval(this.gapTimer);
      const kind = this.gap;
      this.gap = null;
      if (kind === 'punctuation') this.readSegment(true);
      else {
        this.index++;
        this.readNext();
      }
      return;
    }
    this.onStatus(this.gap === 'writing' ? 'writing' : 'speaking');
    this.onPosition({
      phrase: this.index + 1,
      count: this.phrases.length,
      remaining: this.gap === 'writing' ? Math.ceil(this.gapRemaining) : 0,
    });
  }
  togglePause() {
    if (this.stopped) return;
    this.paused = !this.paused;
    if (this.paused) {
      clearTimeout(this.timer);
      if (this.gap)
        this.gapRemaining = Math.max(
          0,
          (this.deadline - performance.now()) / 1000,
        );
      else window.speechSynthesis.pause();
      this.onStatus('paused');
    } else {
      window.speechSynthesis.resume();
      if (this.gap) {
        this.deadline = performance.now() + this.gapRemaining * 1000;
        this.tickGap();
      } else if (!this.utterance) this.readSegment();
      else {
        if (!this.started) this.watchStart();
        this.onStatus('speaking');
      }
    }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.gapTimer);
    if (this.utterance) {
      this.utterance.onend = this.utterance.onstart = null;
      this.utterance.onboundary = this.utterance.onerror = null;
    }
    this.utterance = null;
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
  }
}
