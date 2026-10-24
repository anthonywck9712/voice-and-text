import { type PhrasePosition, type ReadingOptions } from './dictation';
import { browserVoiceChunks } from './browser-voice';
import {
  VoiceChunkValidator,
  type VoiceChunk,
  type VoiceSource,
} from './voice-chunks';
export type ReadingStatus =
  | 'idle'
  | 'preparing'
  | 'speaking'
  | 'buffering'
  | 'paused'
  | 'writing';
type PreparedChunk = VoiceChunk;
type Span = {
  start: number;
  audioFinish: number;
  finish: number;
  offset: number;
  end: number;
  phrase: number;
  count: number;
};

/** Schedule against the audio clock, without adding JS callback gaps. */
export class NeuralPlayer {
  private context = new AudioContext();
  private controller = new AbortController();
  private timer: ReturnType<typeof setInterval> | undefined;
  private sources = new Set<AudioBufferSourceNode>();
  private spans: Span[] = [];
  private pending: PreparedChunk[] = [];
  private nextTime = 0;
  private started = false;
  private finished = false;
  private stopped = false;
  private paused = false;
  private completed = 0;
  private total = 1;
  private lastStatus: ReadingStatus | undefined;
  private options: ReadingOptions = {};
  private lastPosition = '';
  constructor(
    private onStatus: (status: ReadingStatus) => void,
    private onProgress: (progress: number) => void,
    private onPosition: (position: PhrasePosition) => void = () => {},
    private source: VoiceSource = browserVoiceChunks,
  ) {}
  private status(value: ReadingStatus) {
    if (value !== this.lastStatus && !this.stopped) {
      this.lastStatus = value;
      this.onStatus(value);
    }
  }
  async play(
    text: string,
    voice: string,
    speed: number,
    options: ReadingOptions = {},
    // Retained for existing callers; all synthesis now happens inside a worker.
    _endpoint?: '/local-voice' | '/online-voice',
  ) {
    this.options = options;
    this.total = text.length;
    this.status('preparing');
    try {
      // Resume during the initial Play gesture, before loading the voice model.
      await this.context.resume();
      if (this.stopped) return;
      const request = { text, voice, speed, ...options };
      const validator = new VoiceChunkValidator(request);
      this.timer = setInterval(() => this.tick(), 80);
      for await (const chunk of this.source(request, this.controller.signal)) {
        // The worker only computes another chunk when the consumer asks for it.
        await this.waitForCapacity();
        if (this.stopped) return;
        validator.accept(chunk);
        if (options.dictationPause !== undefined) {
          // Buffer each phrase so slower devices cannot insert an unpredictable
          // gap before a punctuation label. Its 220 ms pause is already in PCM.
          this.pending.push(chunk);
          if (chunk.pauseAfter) this.flush();
        } else this.schedule(chunk);
      }
      if (this.stopped) return;
      validator.complete();
      this.finished = true;
      this.flush();
    } catch (error) {
      if (!this.stopped) {
        this.stop();
        throw error;
      }
    }
  }
  private async waitForCapacity() {
    // Wake immediately on Stop, including while the audio clock is suspended.
    while (!this.stopped && this.nextTime - this.context.currentTime > 45) {
      await new Promise<void>((resolve) => {
        const complete = () => {
          clearTimeout(timer);
          this.controller.signal.removeEventListener('abort', complete);
          resolve();
        };
        const timer = setTimeout(complete, 100);
        this.controller.signal.addEventListener('abort', complete, {
          once: true,
        });
      });
    }
  }
  private flush() {
    for (const chunk of this.pending) this.schedule(chunk);
    this.pending = [];
  }
  private schedule(chunk: PreparedChunk) {
    if (this.stopped) return;
    const pcm = chunk.audio;
    const buffer = this.context.createBuffer(1, pcm.length, chunk.sampleRate);
    buffer.copyToChannel(pcm, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.nextTime, this.context.currentTime + 0.035);
    const audioFinish = start + buffer.duration;
    this.nextTime =
      audioFinish +
      (this.options.dictationPause === undefined ? 0 : chunk.pauseAfter || 0);
    this.spans.push({
      start,
      audioFinish,
      phrase: chunk.phrase || 0,
      count: chunk.count || 0,
      finish: this.nextTime,
      offset: chunk.offset,
      end: chunk.end,
    });
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    source.start(start);
    this.started = true;
  }
  private tick() {
    if (this.stopped) return;
    const now = this.context.currentTime;
    while (this.spans.length && this.spans[0].finish <= now)
      this.completed = this.spans.shift()!.end;
    const span = this.spans[0];
    this.onProgress(
      Math.min(
        1,
        (span
          ? span.offset +
            (span.end - span.offset) *
              Math.max(
                0,
                Math.min(
                  1,
                  (now - span.start) / (span.audioFinish - span.start),
                ),
              )
          : this.completed) / this.total,
      ),
    );
    const writing = !!span && now >= span.audioFinish && now < span.finish;
    if (span?.phrase) {
      const position = {
        phrase: span.phrase,
        count: span.count,
        remaining: writing ? Math.ceil(span.finish - now) : 0,
      };
      const key = JSON.stringify(position);
      if (key !== this.lastPosition) {
        this.lastPosition = key;
        this.onPosition(position);
      }
    }
    if (this.finished && this.started && !span) {
      this.onProgress(1);
      this.status('idle');
      this.stop();
    } else
      this.status(
        this.paused
          ? 'paused'
          : !this.started
            ? 'preparing'
            : writing
              ? 'writing'
              : span
                ? 'speaking'
                : 'buffering',
      );
  }
  async togglePause() {
    if (this.stopped) return;
    this.paused = !this.paused;
    if (this.paused) await this.context.suspend();
    else await this.context.resume();
    this.tick();
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    clearInterval(this.timer);
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
      source.disconnect();
    }
    this.sources.clear();
    this.pending = [];
    this.spans = [];
    void this.context.close().catch(() => {});
  }
}
