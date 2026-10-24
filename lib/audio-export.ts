import { dictationPhrases } from './dictation';
import { browserVoiceChunks } from './browser-voice';
import {
  validateVoiceRequest,
  VoiceChunkValidator,
  type VoiceRequest,
  type VoiceSource,
} from './voice-chunks';

export type AudioExportRequest = VoiceRequest & {
  /** @deprecated Synthesis is now entirely on-device. */
  endpoint?: '/local-voice' | '/online-voice';
};
export const MAX_AUDIO_FILE_SECONDS = 60 * 60;
const FILE_TOO_LONG =
  'Audio downloads can be up to 60 minutes. Use a shorter passage or shorter writing pauses.';
function cancelled() {
  return new DOMException('Audio download cancelled.', 'AbortError');
}

function wavHeader(samples: number, sampleRate: number) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const label = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  label(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Integer PCM.
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, samples * 2, true);
  return buffer;
}

/** Build a complete PCM16 WAV from on-device audio; writing pauses are exact silence. */
export async function createAudioFile(
  request: AudioExportRequest,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  source: VoiceSource = browserVoiceChunks,
): Promise<{ blob: Blob; duration: number }> {
  if (signal.aborted) throw cancelled();
  validateVoiceRequest(request);
  if (
    dictationPhrases(request.text).length * (request.dictationPause || 0) >=
    MAX_AUDIO_FILE_SECONDS
  )
    throw new Error(FILE_TOO_LONG);
  const validator = new VoiceChunkValidator(request);
  const parts: BlobPart[] = [];
  let sampleRate = 0;
  let sampleCount = 0;
  let silence: Blob | undefined;
  onProgress(0);
  try {
    for await (const chunk of source(request, signal)) {
      signal.throwIfAborted();
      validator.accept(chunk);
      sampleRate = chunk.sampleRate;
      const pauseSamples = Math.round(chunk.pauseAfter * sampleRate);
      if (
        sampleCount + chunk.samples + pauseSamples >
        sampleRate * MAX_AUDIO_FILE_SECONDS
      )
        throw new Error(FILE_TOO_LONG);
      const pcm = new ArrayBuffer(chunk.samples * 2);
      const output = new DataView(pcm);
      for (let i = 0; i < chunk.samples; i++) {
        const value = Math.max(-1, Math.min(1, chunk.audio[i]));
        output.setInt16(
          i * 2,
          Math.round(value * (value < 0 ? 32768 : 32767)),
          true,
        );
      }
      parts.push(new Blob([pcm]));
      if (pauseSamples) {
        silence ??= new Blob([new ArrayBuffer(pauseSamples * 2)]);
        parts.push(silence);
      }
      sampleCount += chunk.samples + pauseSamples;
      onProgress(Math.min(0.99, chunk.end / request.text.length));
    }
    signal.throwIfAborted();
    validator.complete();
    const blob = new Blob([wavHeader(sampleCount, sampleRate), ...parts], {
      type: 'audio/wav',
    });
    onProgress(1);
    return { blob, duration: sampleCount / sampleRate };
  } catch (error) {
    if (signal.aborted) throw cancelled();
    throw error;
  }
}
