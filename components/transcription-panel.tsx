'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Check,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  Mic,
  MicOff,
  RotateCcw,
  ShieldCheck,
  Square,
  Upload,
  X,
} from 'lucide-react';
import type { useTranscription } from '@/hooks/use-transcription';
import { formatTime, wordCount } from '@/lib/text';
type Props = { audio: ReturnType<typeof useTranscription> };
export default function TranscriptionPanel({ audio }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const replay = useRef<HTMLAudioElement>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [copyError, setCopyError] = useState('');
  const busy = audio.phase !== 'idle';
  const recording = audio.phase === 'recording';
  useEffect(() => {
    if (audio.phase === 'recording' || audio.phase === 'requesting')
      replay.current?.pause();
  }, [audio.phase]);
  const ready = audio.model === 'ready';
  const states = {
    idle: 'Microphone off',
    requesting: 'Waiting for microphone permission',
    recording: 'Microphone on',
    finishing: 'Microphone off · finishing transcript',
    decoding: 'Opening your audio file',
    processing: 'Transcribing your file',
  };
  async function copy() {
    try {
      await navigator.clipboard.writeText(audio.transcript);
      setCopied(true);
      setCopyError('');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        'Copy is unavailable. Select the transcript and copy it, or use Download.',
      );
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([audio.transcript], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Voice & Text transcript.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className={`model-strip ${ready ? 'model-ready' : ''}`}>
        <span className="model-icon">
          {ready ? (
            <Check size={19} />
          ) : audio.model === 'loading' ? (
            <LoaderCircle className="spin" size={20} />
          ) : (
            <AudioLines size={21} />
          )}
        </span>
        <div className="model-copy">
          <strong>
            {ready
              ? 'Speech model ready'
              : audio.model === 'loading'
                ? 'Preparing your speech model…'
                : 'A small download. A more private transcript.'}
          </strong>
          <p>
            {ready
              ? 'English transcription runs on this device.'
              : audio.model === 'loading'
                ? `${(audio.downloadBytes / 1048576).toFixed(1)} MB downloaded. Initializing can take a moment.`
                : 'Load the English speech model once. Your browser caches it when storage is available.'}
          </p>
        </div>
        {audio.model === 'loading' ? (
          <button className="text-button" onClick={audio.cancel}>
            Cancel
          </button>
        ) : !ready ? (
          <button className="primary-button" onClick={audio.loadModel}>
            <Download size={16} />
            Load speech model
          </button>
        ) : (
          <span className="ready-tag">
            <span className="status-dot" />
            Ready
          </span>
        )}
      </div>
      <div className="transcription-workspace">
        <section className="capture-panel" aria-label="Record or open audio">
          <div className="panel-heading">
            <h2>Audio input</h2>
            <span
              className={`recording-status ${recording ? 'is-recording' : ''}`}
            >
              <span />
              {recording ? 'Recording' : 'English'}
            </span>
          </div>
          <div
            className={`microphone-stage ${recording ? 'is-recording' : ''}`}
          >
            <div className="microphone-symbol">
              {recording ? (
                <Mic size={34} strokeWidth={1.5} />
              ) : audio.phase === 'requesting' ? (
                <LoaderCircle className="spin" size={32} />
              ) : (
                <MicOff size={32} strokeWidth={1.5} />
              )}
            </div>
            <div className="recording-time">{formatTime(audio.elapsed)}</div>
            <div className="level-meter" aria-hidden="true">
              {Array.from({ length: 30 }, (_, i) => (
                <span
                  key={i}
                  className={recording && i / 30 < audio.level ? 'lit' : ''}
                />
              ))}
            </div>
            <meter
              className="sr-only"
              aria-label="Microphone input level"
              min={0}
              max={100}
              value={Math.round(audio.level * 100)}
            />
            <p className="microphone-state" aria-live="polite">
              {states[audio.phase]}
            </p>
            {recording ? (
              <button
                className="primary-button record-stop"
                onClick={() => void audio.stopRecording()}
              >
                <Square size={15} fill="currentColor" />
                Stop recording
              </button>
            ) : audio.phase === 'requesting' ? (
              <button className="secondary-button" onClick={audio.cancel}>
                <X size={16} />
                Cancel request
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={!ready || busy}
                onClick={() => void audio.startRecording()}
              >
                <Mic size={17} />
                Start recording
              </button>
            )}
            <p className="record-hint">
              {recording
                ? 'Speak naturally. Pause briefly between sentences.'
                : 'Your microphone turns on only when you record.'}
            </p>
          </div>
          <div className="input-divider">
            <span />
            or open a file
            <span />
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.mp4,.ogg,.flac,.webm"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void audio.transcribeFile(file);
              e.target.value = '';
            }}
          />
          <button
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            disabled={!ready || busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (ready && !busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file && ready && !busy) void audio.transcribeFile(file);
            }}
          >
            <Upload size={22} />
            <strong>Choose an audio file</strong>
            <span>or drop it here</span>
            <small>Up to 100 MB and 20 minutes</small>
          </button>
          <p className="capture-note">
            <ShieldCheck size={14} />
            Files are opened locally, never uploaded.
          </p>
          {audio.recordingUrl && (
            <div className="recording-preview">
              <p id="recording-label">Your last recording</p>
              {/* Audio has an editable transcript on this page. */}
              {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                ref={replay}
                aria-labelledby="recording-label"
                aria-describedby="transcript"
                id="recording-preview"
                aria-label="Play your last recording"
                controls={!recording && audio.phase !== 'requesting'}
                preload="metadata"
                src={audio.recordingUrl}
              />
            </div>
          )}
        </section>
        <section className="transcript-panel" aria-label="English transcript">
          <div className="panel-heading">
            <label htmlFor="transcript">Transcript</label>
            <div className="transcript-actions">
              <button
                className="icon-button"
                disabled={!audio.transcript}
                onClick={copy}
                aria-label={copied ? 'Transcript copied' : 'Copy transcript'}
                title="Copy transcript"
              >
                {copied ? <Check size={17} /> : <Copy size={17} />}
              </button>
              <button
                className="icon-button"
                disabled={!audio.transcript}
                onClick={download}
                aria-label="Download transcript"
                title="Download transcript"
              >
                <Download size={17} />
              </button>
            </div>
          </div>
          {!audio.transcript && !audio.partial && !busy && (
            <div className="transcript-empty" aria-hidden="true">
              <FileText size={27} strokeWidth={1.3} />
              <strong>From spoken to written.</strong>
              <p>
                Record your voice or choose an audio file.
                <br />
                Your English transcript will appear here.
              </p>
            </div>
          )}
          <textarea
            id="transcript"
            className={`transcript-text ${!audio.transcript && !audio.partial && !busy ? 'empty' : ''}`}
            aria-label="Editable English transcript"
            value={audio.transcript}
            onChange={(e) => audio.setTranscript(e.target.value)}
            placeholder={
              busy ? 'Listening for your words…' : 'Edit your transcript here…'
            }
            spellCheck
          />
          {audio.partial && (
            <div className="partial-transcript">
              <span>Draft, still processing</span>
              <p>{audio.partial}</p>
            </div>
          )}
          {busy && (
            <output className="processing-state">
              <LoaderCircle size={16} className="spin" />
              <span>
                {audio.phase === 'recording'
                  ? audio.pending
                    ? 'Transcribing as you speak…'
                    : 'Listening for speech…'
                  : audio.phase === 'requesting'
                    ? 'Allow access in your browser’s microphone prompt.'
                    : audio.phase === 'finishing'
                      ? 'Finishing the last words…'
                      : audio.phase === 'decoding'
                        ? 'Decoding audio on your device…'
                        : `Transcribing ${audio.fileName}…`}
              </span>
              {!recording && audio.phase !== 'requesting' && (
                <button className="text-button" onClick={audio.cancel}>
                  Cancel
                </button>
              )}
            </output>
          )}
          <div className="transcript-footer">
            <span>{wordCount(audio.transcript)} words</span>
            <span>Editable text</span>
            <button
              className="text-button"
              disabled={!audio.transcript || busy}
              onClick={() => audio.setTranscript('')}
            >
              <RotateCcw size={14} />
              Clear
            </button>
          </div>
        </section>
      </div>
      {(audio.error || copyError) && (
        <div className="inline-error" role="alert">
          {audio.error || copyError}
        </div>
      )}
      {audio.notice && (
        <output className="inline-notice">{audio.notice}</output>
      )}
      <p className="accuracy-note">
        Live captions arrive in short segments. Speed and accuracy vary by
        device; review names, numbers, and punctuation before using your
        transcript.
      </p>
    </>
  );
}
