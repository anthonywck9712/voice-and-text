export const SAMPLE_RATE = 16000;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_FILE_SECONDS = 20 * 60;
export const MAX_RECORD_SECONDS = 10 * 60;

export function resampleMono(
  input: Float32Array,
  fromRate: number,
  toRate = SAMPLE_RATE,
) {
  if (fromRate <= 0 || toRate <= 0) throw new Error('Invalid sample rate');
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  // Area averaging acts as a simple low-pass filter during downsampling.
  for (let i = 0; i < output.length; i++) {
    const start = i * ratio,
      end = Math.min((i + 1) * ratio, input.length);
    let sum = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++)
      sum += input[j] * (Math.min(end, j + 1) - Math.max(start, j));
    output[i] = sum / (end - start);
  }
  return output;
}
export function rms(input: Float32Array) {
  return input.length
    ? Math.sqrt(input.reduce((sum, x) => sum + x * x, 0) / input.length)
    : 0;
}
export function joinAudio(parts: Float32Array[]) {
  const result = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export type AudioSegment = { audio: Float32Array; overlap: boolean };
// Voice-activity segmentation: 0.8s pause or a 6s window; 0.5s overlap only at forced boundaries.
export class SpeechSegmenter {
  private parts: Float32Array[] = [];
  private samples = 0;
  private silence = 0;
  private voiced = 0;
  private overlap = false;
  private preroll = new Float32Array(0);
  feed(audio: Float32Array): AudioSegment | null {
    const speech = rms(audio) >= 0.008;
    if (!this.parts.length && !speech) {
      this.preroll = audio.slice(-3200);
      return null;
    }
    if (!this.parts.length && this.preroll.length) {
      this.parts.push(this.preroll);
      this.samples += this.preroll.length;
      this.preroll = new Float32Array(0);
    }
    this.parts.push(audio);
    this.samples += audio.length;
    if (speech) {
      this.voiced += audio.length;
      this.silence = 0;
    } else this.silence += audio.length;
    if (this.silence >= SAMPLE_RATE * 0.8) return this.flush(false);
    if (this.samples >= SAMPLE_RATE * 6) return this.flush(true);
    return null;
  }
  flush(keepTail = false): AudioSegment | null {
    const audio = joinAudio(this.parts);
    const overlap = this.overlap;
    const voiced = this.voiced;
    this.parts = [];
    this.samples = 0;
    this.silence = 0;
    this.voiced = 0;
    this.overlap = false;
    if (keepTail && audio.length) {
      const tail = audio.slice(-8000);
      this.parts = [tail];
      this.samples = tail.length;
      this.overlap = true;
    }
    // A final short word following a forced split still needs its retained context.
    return voiced >= SAMPLE_RATE * 0.15 || (overlap && voiced > 0)
      ? { audio, overlap }
      : null;
  }
}

export function appendTranscript(
  existing: string,
  next: string,
  overlap = false,
) {
  const incoming = next.trim();
  if (!incoming) return existing;
  if (!existing.trim()) return incoming;
  if (!overlap) return `${existing.trimEnd()}\n\n${incoming}`;
  const left = existing.trimEnd().split(/\s+/);
  const right = incoming.split(/\s+/);
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, '');
  for (let size = Math.min(12, left.length, right.length); size > 0; size--) {
    if (
      left
        .slice(-size)
        .every((word, i) => normalize(word) === normalize(right[i]))
    ) {
      return `${existing.trimEnd()}${right.length > size ? ' ' + right.slice(size).join(' ') : ''}`;
    }
  }
  return `${existing.trimEnd()} ${incoming}`;
}

export function microphoneError(error: unknown) {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String(error.name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was blocked. Allow it in your browser’s site settings, then try recording again.';
  if (name === 'NotFoundError')
    return 'No microphone was found. Connect a microphone and try again.';
  if (name === 'NotReadableError')
    return 'The microphone is unavailable. Close other apps using it, reconnect it, and try again.';
  return 'Recording could not start. Check your microphone and browser permissions, then try again.';
}
