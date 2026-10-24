'use client';
import { useSyncExternalStore } from 'react';
import {
  getBrowserVoiceSnapshot,
  subscribeBrowserVoice,
} from '@/lib/browser-voice';

/** One progress source for both reading aloud and creating a WAV file. */
export function useBrowserVoice() {
  return useSyncExternalStore(
    subscribeBrowserVoice,
    getBrowserVoiceSnapshot,
    getBrowserVoiceSnapshot,
  );
}
