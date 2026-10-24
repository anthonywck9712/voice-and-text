# Browser architecture

`main.tsx` mounts the React application; Vite produces a static site. There are no application endpoints, session tokens, Azure credentials, or NAS dependencies in the browser edition.

## Speech lifecycle and latency

`lib/browser-voice.ts` owns one speech worker and one active inference job. It sends demand for one transferred PCM chunk at a time. `lib/voice.worker.ts` loads Kokoro or Supertonic on demand; switching engines releases the previous worker to bound memory. A stopped job terminates inference, discards queued PCM and ignores stale job messages. Public model downloads may remain cached by the browser.

Kokoro uses its own pinned Transformers 3 runtime, shared with the package’s Tensor constructor through a Vite resolver. Whisper uses Transformers 4 independently. Copy each matching ONNX runtime using `scripts/prepare-assets.mjs`; mixing runtime binaries causes initialization failures. Single-thread WebAssembly avoids requiring cross-origin isolation headers on GitHub Pages.

`lib/voice-chunks.ts` retains source offsets through chunking and spoken punctuation. Dictation buffers a complete phrase before playback to avoid arbitrary gaps within it; each punctuation name has a 220 ms PCM prefix. One writing pause follows each final phrase segment. Normal reading starts with the first complete chunk. Downloads encode PCM and silence directly without waiting for audible playback.

`NeuralPlayer` resumes its AudioContext within the play gesture and schedules sources against the audio clock. Pause suspends that clock, including writing countdowns. Stop aborts the worker job, closes the audio context and releases sources. Browser background/auto-play rules still apply; keep the page visible when testing playback.

Download progress, initialization and generation are distinct UI states. A model error or stalled operation resets the worker so another attempt can succeed. Inference diagnostics contain only phase/error categories; model-loading diagnostics may include public asset/runtime errors. Neither may log passage text or audio. No background retries send user content or bill a provider.

## Transcription and files

Whisper runs in `lib/transcriber.worker.ts`. It uses the Transformers 4 Asyncify runtime (plain WASM on Safari), with basic graph optimization to avoid the pinned ONNX runtime’s incompatible quantized decoder fusion. The microphone is requested only after a recording action; stop, page exit and interruption release tracks. The UI handles denied/missing/busy microphones and preserves completed text after an error. Transcription is English-only and can make mistakes.

Document extraction uses local PDF/DOCX workers and renders plain text. Audio is decoded/resampled on the device. Shared files, source recordings, credentials and personal deployment history must never be added to the public repository.

## Deployment

All runtime asset paths use the build base. Test the `/voice-and-text/` project path, including PDF workers, transcription runtimes and audio capture worklets. Model URLs are HTTPS, pinned upstream references. Changes to GitHub Pages origin create a new permission/cache context.

The public release excludes the old NAS server/Compose files, private environment files, generated caches, personal school documents and deployment evidence. The old hosted version is a separate deployment; publishing this edition does not shut it down.

## Validation

Run `npm run typecheck`, `npm run test:browser` and `npm run build:pages`. Unit tests cover lifecycle cancellation/retry, bounded buffering, source coverage, punctuation timing, export sample rates, installed voices and model catalog identity. They use stubbed inference and do not establish actual voice quality. Complete the real browser, permissions, download, cache and recovery checklist in [GITHUB-PAGES.md](GITHUB-PAGES.md) before claiming those behaviors verified.

## Dependencies

The browser build excludes Node-only image-processing code inherited through the model libraries. The package audit currently flags the transitive Node `sharp` dependency; it is not bundled in the static site. Keep pinned dependencies and public model revisions under review when updating. See [third-party licences](THIRD_PARTY_NOTICES.md).
