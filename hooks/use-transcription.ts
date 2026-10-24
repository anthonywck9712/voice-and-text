'use client';
import { assetUrl } from '@/lib/assets';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendTranscript,
  MAX_FILE_BYTES,
  MAX_FILE_SECONDS,
  MAX_RECORD_SECONDS,
  microphoneError,
  resampleMono,
  rms,
  SAMPLE_RATE,
  SpeechSegmenter,
  type AudioSegment,
} from '@/lib/audio';

type Phase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'finishing'
  | 'decoding'
  | 'processing';
type Job = AudioSegment & { id: number; source: 'live' | 'file' };
type Capture = {
  stream: MediaStream;
  context: AudioContext;
  node: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
  recorder: MediaRecorder | null;
  flushed: (() => void) | null;
};

export function useTranscription() {
  const [model, setModel] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [downloadBytes, setDownloadBytes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const phaseRef = useRef<Phase>('idle');
  const worker = useRef<Worker | null>(null);
  const capture = useRef<Capture | null>(null);
  const requestedStream = useRef<MediaStream | null>(null);
  const segmenter = useRef<SpeechSegmenter | null>(null);
  const queue = useRef<Job[]>([]);
  const currentJob = useRef<Job | null>(null);
  const token = useRef(0);
  const nextId = useRef(0);
  const ready = useRef(false);
  const audioUrl = useRef('');
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pumpRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const phaseTo = useCallback((value: Phase) => {
    phaseRef.current = value;
    setPhaseState(value);
  }, []);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const release = useCallback(() => {
    const c = capture.current;
    capture.current = null;
    requestedStream.current?.getTracks().forEach((track) => track.stop());
    requestedStream.current = null;
    if (c) {
      c.stream.getTracks().forEach((track) => track.stop());
      if (c.recorder && c.recorder.state !== 'inactive') c.recorder.stop();
      c.node.port.onmessage = null;
      c.node.disconnect();
      c.source.disconnect();
      void c.context.close().catch(() => {});
      c.flushed?.();
    }
    setLevel(0);
  }, []);

  const cancel = useCallback(() => {
    token.current++;
    clearTimer();
    release();
    segmenter.current = null;
    worker.current?.terminate();
    worker.current = null;
    ready.current = false;
    queue.current = [];
    currentJob.current = null;
    setPending(0);
    setPartial('');
    setModel('idle');
    phaseTo('idle');
  }, [clearTimer, release, phaseTo]);

  const fail = useCallback(
    (message: string) => {
      cancel();
      setModel('error');
      setError(message);
    },
    [cancel],
  );
  const finishIfDrained = useCallback(() => {
    setPending(queue.current.length + (currentJob.current ? 1 : 0));
    if (
      !capture.current &&
      !queue.current.length &&
      !currentJob.current &&
      ['finishing', 'processing'].includes(phaseRef.current)
    )
      phaseTo('idle');
  }, [phaseTo]);

  const pump = useCallback(() => {
    if (currentJob.current || !worker.current || !ready.current) return;
    const job = queue.current.shift();
    if (!job) {
      finishIfDrained();
      return;
    }
    currentJob.current = job;
    setPartial('');
    setPending(queue.current.length + 1);
    clearTimer();
    timer.current = setTimeout(
      () =>
        fail(
          'Transcription took too long. Your completed text is safe. Reload the speech model and try a shorter clip.',
        ),
      job.source === 'file' ? 600000 : 90000,
    );
    worker.current.postMessage(
      { type: 'transcribe', jobId: job.id, audio: job.audio },
      [job.audio.buffer],
    );
  }, [clearTimer, fail, finishIfDrained]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const loadModel = useCallback(() => {
    if (worker.current || phaseRef.current !== 'idle') return;
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      setError(
        'This browser cannot run the speech model. Try a current version of Safari, Chrome, Edge, or Firefox.',
      );
      setModel('error');
      return;
    }
    setError('');
    setNotice('');
    setModel('loading');
    setDownloadBytes(0);
    try {
      const w = new Worker(
        new URL('../lib/transcriber.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.current = w;
      let loading = true;
      let receivedBytes = 0;
      const armLoadTimeout = () => {
        clearTimer();
        timer.current = setTimeout(() => {
          if (loading && worker.current === w)
            fail(
              'The speech model stopped making progress. Check your connection, then select Load speech model to retry.',
            );
        }, 180000);
      };
      w.onmessage = ({ data }) => {
        if (worker.current !== w) return;
        if (data.type === 'loading') {
          // Only actual byte progress extends the initial load deadline.
          // Late loading messages cannot replace a transcription job's timer.
          if (!loading) return;
          if (Number.isFinite(data.bytes) && data.bytes > receivedBytes) {
            receivedBytes = data.bytes;
            setDownloadBytes(receivedBytes);
            armLoadTimeout();
          }
          return;
        }
        if (data.type === 'ready') {
          if (!loading) return;
          loading = false;
          clearTimer();
          ready.current = true;
          setModel('ready');
          return;
        }
        if (data.type === 'error') {
          loading = false;
          fail(data.message);
          return;
        }
        const job = currentJob.current;
        if (!job || data.jobId !== job.id) return;
        if (data.type === 'partial')
          setPartial((previous) => previous + data.delta);
        if (data.type === 'complete') {
          clearTimer();
          setTranscript((previous) =>
            appendTranscript(previous, data.text, job.overlap),
          );
          if (!data.text.trim())
            setNotice('No clear English speech was detected in this audio.');
          setPartial('');
          currentJob.current = null;
          pumpRef.current();
          finishIfDrained();
        }
      };
      w.onerror = (event) => {
        event.preventDefault();
        if (worker.current === w)
          fail(
            'The local speech engine stopped. Reload the model and retry with a shorter clip. Your completed text is still here.',
          );
      };
      armLoadTimeout();
      w.postMessage({ type: 'load' });
    } catch {
      fail(
        'The speech engine could not start. Reload this page in a current browser and try again.',
      );
    }
  }, [clearTimer, fail, finishIfDrained]);

  const enqueue = useCallback(
    (segment: AudioSegment | null, source: 'live' | 'file' = 'live') => {
      if (!segment) return;
      queue.current.push({ ...segment, id: ++nextId.current, source });
      pumpRef.current();
      setPending(queue.current.length + (currentJob.current ? 1 : 0));
      if (
        source === 'live' &&
        queue.current.length >= 4 &&
        phaseRef.current === 'recording'
      ) {
        setNotice(
          'Recording stopped because transcription is catching up. Wait for it to finish, then start again. Your audio is available below.',
        );
        void stopRef.current();
      }
    },
    [],
  );

  const stopRecording = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    phaseTo('finishing');
    const c = capture.current;
    const run = token.current;
    const endingSegmenter = segmenter.current;
    // Stop the physical microphone immediately; flush the worklet's already captured tail.
    c?.stream.getTracks().forEach((track) => track.stop());
    if (c) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 400);
        c.flushed = () => {
          clearTimeout(timeout);
          resolve();
        };
        c.node.port.postMessage('flush');
      });
    }
    if (run !== token.current || capture.current !== c) return;
    enqueue(endingSegmenter?.flush() || null);
    segmenter.current = null;
    release();
    finishIfDrained();
  }, [enqueue, finishIfDrained, phaseTo, release]);
  useEffect(() => {
    stopRef.current = stopRecording;
  }, [stopRecording]);

  const startRecording = useCallback(async () => {
    if (!ready.current || phaseRef.current !== 'idle') return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        'Microphone access requires localhost or HTTPS and a supported browser.',
      );
      return;
    }
    setError('');
    setNotice('');
    setFileName('');
    setElapsed(0);
    phaseTo('requesting');
    const run = ++token.current;
    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (run !== token.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      requestedStream.current = stream;
      context = new AudioContext({ sampleRate: SAMPLE_RATE });
      await context.resume();
      await context.audioWorklet.addModule(assetUrl('pcm-capture.js'));
      if (run !== token.current) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      let recorder: MediaRecorder | null = null;
      if (typeof MediaRecorder !== 'undefined') {
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
          (type) => MediaRecorder.isTypeSupported(type),
        );
        recorder = new MediaRecorder(
          stream,
          mime ? { mimeType: mime } : undefined,
        );
        const blobs: Blob[] = [];
        const rec = recorder;
        rec.ondataavailable = (e) => {
          if (e.data.size) blobs.push(e.data);
        };
        rec.onstop = () => {
          if (!blobs.length || run !== token.current) return;
          if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
          audioUrl.current = URL.createObjectURL(
            new Blob(blobs, { type: rec.mimeType }),
          );
          setRecordingUrl(audioUrl.current);
        };
        rec.onerror = () => {
          setNotice(
            'The audio preview could not be saved. Transcription is still available.',
          );
        };
        recorder.start(1000);
      }
      const c: Capture = {
        stream,
        context,
        node,
        source,
        recorder,
        flushed: null,
      };
      capture.current = c;
      segmenter.current = new SpeechSegmenter();
      node.port.onmessage = ({ data }) => {
        if (run !== token.current) return;
        if (data.type === 'flushed') {
          c.flushed?.();
          return;
        }
        if (data.type === 'audio') {
          const pcm = resampleMono(data.audio, c.context.sampleRate);
          setLevel(Math.min(1, rms(pcm) * 8));
          enqueue(segmenter.current?.feed(pcm) || null);
        }
      };
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener('ended', () => {
          if (phaseRef.current === 'recording') {
            setNotice(
              'The microphone disconnected. Captured speech is being finished. Reconnect it before recording again.',
            );
            void stopRef.current();
          }
        }),
      );
      source.connect(node);
      node.connect(context.destination);
      started.current = Date.now();
      phaseTo('recording');
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== 'closed') void context.close();
      if (run === token.current) {
        release();
        phaseTo('idle');
        setError(microphoneError(error));
      }
    }
  }, [enqueue, phaseTo, release]);

  const transcribeFile = useCallback(
    async (file: File) => {
      if (!ready.current || phaseRef.current !== 'idle') return;
      setError('');
      setNotice('');
      if (!file.size || file.size > MAX_FILE_BYTES) {
        setError('Choose a non-empty audio file under 100 MB.');
        return;
      }
      if (
        !file.type.startsWith('audio/') &&
        !/\.(wav|mp3|m4a|mp4|ogg|oga|webm|flac|aac)$/i.test(file.name)
      ) {
        setError('Choose an audio file, such as WAV, MP3, M4A, or WebM.');
        return;
      }
      const run = ++token.current;
      phaseTo('decoding');
      setFileName(file.name);
      let context: AudioContext | null = null;
      try {
        context = new AudioContext();
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        if (run !== token.current) return;
        if (decoded.duration > MAX_FILE_SECONDS) throw new Error('duration');
        const mono = new Float32Array(decoded.length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const values = decoded.getChannelData(channel);
          for (let i = 0; i < mono.length; i++)
            mono[i] += values[i] / decoded.numberOfChannels;
        }
        const audio = resampleMono(mono, decoded.sampleRate);
        if (rms(audio) < 0.001) {
          phaseTo('idle');
          setNotice(
            'This file appears to be silent. Choose a recording with audible English speech.',
          );
          return;
        }
        phaseTo('processing');
        enqueue({ audio, overlap: false }, 'file');
      } catch (error) {
        if (run === token.current) {
          phaseTo('idle');
          setError(
            error instanceof Error && error.message === 'duration'
              ? 'This file is longer than 20 minutes. Split it into shorter clips and try again.'
              : 'This audio file could not be decoded. Try converting it to WAV or MP3, then open it again.',
          );
        }
      } finally {
        if (context && context.state !== 'closed') void context.close();
      }
    },
    [enqueue, phaseTo],
  );

  useEffect(() => {
    if (phase !== 'recording') return;
    const interval = setInterval(() => {
      const seconds = (Date.now() - started.current) / 1000;
      setElapsed(seconds);
      if (seconds >= MAX_RECORD_SECONDS) {
        setNotice(
          'The 10-minute recording limit was reached. Save your transcript and start a new recording.',
        );
        void stopRef.current();
      }
    }, 200);
    return () => clearInterval(interval);
  }, [phase]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && phaseRef.current === 'recording') {
        setNotice(
          'Recording stopped when this page moved to the background. Start again when you are ready.',
        );
        void stopRef.current();
      }
    };
    const leave = () => {
      cancel();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      leave();
      clearTimer();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, [cancel, clearTimer]);
  return {
    model,
    phase,
    transcript,
    setTranscript,
    partial,
    error,
    notice,
    downloadBytes,
    elapsed,
    level,
    pending,
    recordingUrl,
    fileName,
    loadModel,
    cancel,
    startRecording,
    stopRecording,
    transcribeFile,
  };
}
