# Voice & Text

[Open Voice & Text](https://anthonywck9712.github.io/voice-and-text/)

A free English voice studio that runs on the visitor’s device. Static hosting requires no application server, API key, Azure subscription, or visitor account.

- 28 American and British Kokoro voices and 10 additional Supertonic English presets.
- Teacher dictation from pasted text, TXT, DOCX and selectable-text PDF, with editable phrase breaks, writing time and optional spoken punctuation.
- A 220 ms pause before spoken punctuation; writing pauses occur once per phrase.
- WAV creation and downloads, independent of live playback.
- English microphone/file transcription using Whisper in a browser worker.

Models download from pinned public Hugging Face URLs only when needed. The browser caches them where possible. Text, documents and recordings are processed locally. Network providers still receive ordinary requests for site/model files; the app has no analytics or speech API.

## Run locally

Use Node.js 22.18 or newer:

```sh
npm ci
npm run dev
```

Open the localhost address printed by Vite. For a production preview under the GitHub project path:

```sh
npm run build:pages
PAGES_BASE_PATH=/voice-and-text/ npm run preview
```

## Publish

The GitHub Actions workflow builds and publishes `dist/client` on pushes to `main`. Set **Settings → Pages → Source → GitHub Actions**. The project path is `/voice-and-text/`; change both the workflow and `build:pages` script if renaming the repository. No secrets are required.

See [the hosting and testing guide](GITHUB-PAGES.md), [developer notes](DEVELOPER.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Before the first reading

Kokoro’s quantized voice model is about 88 MB, plus runtime assets. Supertonic’s separate voice models are about 400 MB. The first download and initialization can take time; later readings can reuse cached files. CPU speed, memory, browser storage and background-tab restrictions affect performance. There is no guarantee of faster generation on older phones.

Supertonic voices are free under OpenRAIL-M, including use restrictions. Read the linked model licence in the app before selecting them. Generated voices are synthetic; disclose this when sharing Supertonic audio. Installed device voices vary by system and cannot be exported through this app.

The website needs HTTPS for microphone access (localhost is allowed for development). Refreshing or closing the page loses unsaved passages and transcripts; save audio and text before leaving.
