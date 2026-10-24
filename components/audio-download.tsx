'use client';
import { Download, FileAudio, LoaderCircle } from 'lucide-react';
import type { useAudioDownload } from '@/hooks/use-audio-download';

export default function AudioDownload({
  audio,
  disabled,
  supported,
  dictation,
  readPunctuation = false,
  voiceId,
}: {
  audio: ReturnType<typeof useAudioDownload>;
  disabled: boolean;
  supported: boolean;
  dictation: boolean;
  readPunctuation?: boolean;
  voiceId: string;
}) {
  const busy = audio.phase === 'generating';
  const ready = audio.phase === 'ready';
  const seconds = Math.round(audio.duration);
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const filename = `voice-text-${dictation ? 'dictation-' : ''}${voiceId.replace(/^[^:]+:/, '').replace(/[^a-z0-9-]/gi, '-')}${readPunctuation ? '-spoken-punctuation' : ''}.wav`;
  return (
    <section className="audio-download" aria-label="Save audio">
      <div className="download-row">
        <div className="download-description">
          <FileAudio size={19} aria-hidden="true" />
          <div>
            <strong aria-live="polite">
              {busy
                ? 'Creating your audio file…'
                : ready
                  ? 'Your audio file is ready'
                  : 'Save audio for later'}
            </strong>
            <p>
              {ready
                ? `${duration} · ${(audio.bytes / (1024 * 1024)).toFixed(1)} MB · WAV`
                : !supported
                  ? 'Choose a neural voice to download audio.'
                  : dictation
                    ? `WAV with ${readPunctuation ? 'spoken punctuation and ' : ''}your writing pauses, including the final pause.`
                    : 'A WAV file with your selected voice and reading speed.'}
            </p>
          </div>
        </div>
        {busy ? (
          <button className="text-button" onClick={audio.cancel}>
            Cancel
          </button>
        ) : ready ? (
          <a
            className="secondary-button download-button"
            href={audio.url}
            download={filename}
          >
            <Download size={16} />
            Download WAV
          </a>
        ) : (
          <button
            className="secondary-button download-button"
            disabled={disabled || !supported}
            onClick={() => void audio.create()}
          >
            <Download size={16} />
            Create audio file
          </button>
        )}
      </div>
      {busy && (
        <div className="download-progress">
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
          <progress
            aria-label="Audio file progress"
            max={1}
            value={audio.progress}
          />
          <span>{Math.min(99, Math.round(audio.progress * 100))}%</span>
        </div>
      )}
      {supported && !ready && (
        <p className="download-note">
          {busy
            ? 'Keep this page open. Nothing will play aloud.'
            : 'Up to 60 minutes per file. No need to play the passage first.'}
        </p>
      )}
      {ready && (
        <p className="download-note">
          Download again without creating new speech. Save the file before
          editing or closing this page.
        </p>
      )}
      {audio.error && (
        <p className="download-error" role="alert">
          {audio.error}
        </p>
      )}
    </section>
  );
}
