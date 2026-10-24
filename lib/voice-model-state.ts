import type { BrowserVoiceSnapshot } from './browser-voice';

/** Hide stale progress when the selected voice or the active job has changed. */
export function voiceModelState(
  snapshot: BrowserVoiceSnapshot,
  engine: 'kokoro' | 'supertonic',
  jobActive: boolean,
) {
  const selectedEngine = snapshot.engine === engine;
  const downloading =
    selectedEngine && jobActive && snapshot.stage === 'downloading';
  const initializing =
    selectedEngine && jobActive && snapshot.stage === 'initializing';
  return {
    busy: downloading || initializing,
    downloading,
    ready: selectedEngine && ['ready', 'generating'].includes(snapshot.stage),
    // Unknown totals and initialization are indeterminate, never fabricated percentages.
    progress:
      downloading &&
      typeof snapshot.progress === 'number' &&
      Number.isFinite(snapshot.progress)
        ? Math.max(0, Math.min(1, snapshot.progress))
        : undefined,
    bytes: downloading ? Math.max(0, snapshot.bytes) : 0,
    total:
      downloading && snapshot.total && snapshot.total > 0
        ? snapshot.total
        : undefined,
  };
}
