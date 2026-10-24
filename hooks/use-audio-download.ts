'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioFile, type AudioExportRequest } from '@/lib/audio-export';

type DownloadState = {
  key: string;
  phase: 'idle' | 'generating' | 'ready';
  progress: number;
  url: string;
  duration: number;
  bytes: number;
  error: string;
};
const EMPTY: DownloadState = {
  key: '',
  phase: 'idle',
  progress: 0,
  url: '',
  duration: 0,
  bytes: 0,
  error: '',
};

export function useAudioDownload(request: AudioExportRequest | null) {
  const key = JSON.stringify(request);
  const [state, setState] = useState(EMPTY);
  const controller = useRef<AbortController | null>(null);
  const objectUrl = useRef('');
  const generation = useRef(0);
  const release = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
  }, []);
  const cancel = useCallback(() => {
    release();
    setState(EMPTY);
  }, [release]);

  useEffect(() => {
    // The request changed: revoke its old file and reset the associated job UI.
    // oxlint-disable-next-line react/react-compiler
    cancel();
    return release;
  }, [key, cancel, release]);
  useEffect(() => {
    window.addEventListener('pagehide', cancel);
    return () => window.removeEventListener('pagehide', cancel);
  }, [cancel]);

  const create = useCallback(async () => {
    const snapshot = JSON.parse(key) as AudioExportRequest | null;
    if (!snapshot || controller.current) return;
    release();
    const id = generation.current;
    const job = new AbortController();
    controller.current = job;
    setState({ ...EMPTY, key, phase: 'generating' });
    try {
      const result = await createAudioFile(snapshot, job.signal, (progress) => {
        if (generation.current === id)
          setState((previous) => ({ ...previous, progress }));
      });
      if (generation.current !== id || job.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      objectUrl.current = url;
      setState({
        key,
        phase: 'ready',
        progress: 1,
        url,
        duration: result.duration,
        bytes: result.blob.size,
        error: '',
      });
    } catch (problem) {
      if (generation.current !== id || job.signal.aborted) return;
      const error =
        problem instanceof TypeError
          ? 'The voice model could not load. Check your connection for the first download, then try again. If this device runs out of memory, use a shorter passage or close other tabs.'
          : problem instanceof Error
            ? problem.message
            : 'The audio file could not be created. Try again.';
      setState({ ...EMPTY, key, error });
    } finally {
      if (controller.current === job) controller.current = null;
    }
  }, [key, release]);

  // A settings change hides an old file immediately, before effect cleanup.
  return { ...(state.key === key ? state : EMPTY), create, cancel };
}
