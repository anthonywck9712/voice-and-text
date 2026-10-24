# Voice & Text on GitHub Pages

This edition is a static website. GitHub Pages serves the page, JavaScript, fonts and browser runtimes. Each visitor’s browser generates speech, extracts uploaded passages and transcribes recordings. It does not require the Synology, a Node.js speech server, Azure, an OpenAI API key or a visitor account.

The publishing instructions and the current live-address status belong in [README.md](README.md). This guide explains what happens in the browser and how to check a deployment. A successful local build is not evidence that GitHub Pages has deployed it.

## Free voices

The menu includes **38 neural voices**: 28 Kokoro voices (20 American and eight British) and ten Supertonic presets (F1–F5 and M1–M5). Supertonic’s publisher does not identify regional English accents for those presets, so they appear under **English**. Other accents, including Hong Kong and Singaporean English, appear only when the visitor’s browser reports a matching installed, local system voice. Remote system voices are excluded.

Azure subscription voices and their settings are removed. Installed system voices can play readings and dictations, but they cannot create a downloadable WAV through the browser speech-synthesis interface. Choose a neural voice for downloads.

Supertonic’s model terms require downstream users to comply with its usage restrictions. Its selected-voice notice links to the [model licence](public/licenses/supertonic-model.txt), requires agreement before use, and tells users to identify shared output as synthetic speech. The separate [code licence](public/licenses/supertonic-code.txt) and [third-party notices](THIRD_PARTY_NOTICES.md) preserve attribution. These notices do not require an account or subscription.

## First use, latency and caching

No speech model downloads just because someone opens the page or changes the selected voice. Pressing **Preview voice**, **Read text aloud**, **Start dictation** or **Create audio file** starts the necessary neural model download. The transcription model has a separate **Load speech model** button.

Model files are fetched from their public model host into the browser. Supertonic’s four model files total about **398 MB**, plus small configuration and voice files; it downloads only when a Supertonic voice is used. Kokoro is a separate model, so changing between the two engines can require another first-use download. Selecting another voice within an engine does not require another full copy of the same model.

The settings panel displays downloaded bytes and a progress bar when the total is known. Initialization remains indeterminate: a completed download does not mean the browser has finished preparing the model. Speech generation then depends on the visitor’s CPU, available memory and the passage. Long passages and older/mobile devices can take longer. This is not a guarantee that browser generation will beat the NAS on every device.

The browser caches downloaded model files when storage is available. Private browsing, storage pressure, clearing site data and browser cache policies can remove them. A later visit can therefore need another download. No service worker currently guarantees that the entire website will open offline; “on your device” describes where speech is processed, not a promise of offline page availability.

## Reading and download lifecycle

- Only one neural reading or file-generation job runs at a time. Voice, speed and passage changes are locked while it runs so the result matches the visible settings.
- **Pause** suspends the reading’s audio clock, including dictation writing time. The worker produces bounded chunks rather than accumulating the whole passage while paused. **Resume** continues the same reading.
- **Stop** cancels the active reading, releases playback resources and terminates an active model job. Cached model files may remain, but another reading may need model initialization again. **Cancel** does the equivalent for an audio-file job.
- Leaving the page cancels active work. Download a completed WAV or transcript before closing it. Prepared files are held in the current page and are cleared when their text or settings change.
- Dictation uses each reviewed line as a phrase. The selected 3–30-second writing pause is included after every phrase, including the last. **Read punctuation aloud** adds a brief 0.22-second pause before each spoken punctuation cue. Playback and WAV generation use the same timing data.
- The browser edition limits the visible reading editor to 5,000 characters and 100 dictation phrases as a practical memory safeguard. If an imported passage is longer, split it before playing. Audio export has a separate 60-minute limit including silence.

## Permissions, privacy and recovery

Text-to-voice does not request microphone access. Playback starts from a button press so the browser can authorize audio. If sound does not begin, use Stop and then Play with the page in the foreground; check the selected output device and browser/site sound settings.

Voice-to-text requests microphone access only after **Start recording**. Use the HTTPS GitHub Pages address, allow the browser’s microphone prompt, and select the correct input device. If permission is denied, change that site’s permission in the browser and retry. Recording stops when the page goes into the background, and the UI reports that it has stopped. File transcription does not need microphone permission.

Passage text, generated speech, recordings and transcripts are processed on the visitor’s device. The website/model hosts still receive ordinary asset-download requests, including normal network metadata. Models use browser caching; passages and recordings are not uploaded to a speech API by this app. Save work before reloading: the page is not persistent document storage.

If model preparation fails, the app reports an error and releases the current job. Retry with an internet connection for any uncached files. If the device runs out of memory or a worker stops, close other busy tabs, try a shorter passage, or choose a local installed voice. A model download can be retried; users should not need to restart a Synology project or keep a desktop terminal open.

GitHub Pages is a static host. There is no application session token to refresh and no server audio connection to reconnect. Network recovery means loading missing page/model assets again; it does not resume a partially generated passage from a remote session.

## Validation checklist

The automated checks below were run on **25 October 2026**:

- `node --test tests/browser-voice-ui.test.mjs`: **7 passed**. Covers the 38 free voice choices, published-voice-only inference routing, exclusion of paid/remote options, retention of genuine local Hong Kong/Singaporean voices, determinate versus indeterminate progress, and stale/cancelled progress handling.
- Targeted lint on the changed UI/hooks and these helpers: **passed**.

These are logic checks, not real-audio or deployment evidence. The following deployment/browser checks remain unchecked in this guide; record actual results and browser/device details in the release validation record.

- [ ] Open the published HTTPS URL on a device outside the home network with the Synology unavailable. Verify the page and all runtime assets load at the GitHub Pages project path.
- [ ] In a fresh browser profile, generate a short Kokoro reading. Observe download and initialization states, then listen to actual audio.
- [ ] Select Supertonic, read and accept its model terms, and generate a short reading. Confirm its optional model download, actual audio and the synthetic-speech notice.
- [ ] Reload and repeat a reading. Confirm cached model reuse where the browser permits it; do not mistake initialization time for another full download.
- [ ] Cancel during a model download and again during generation. Retry; verify no stale playback, file, busy state or fabricated progress remains.
- [ ] Disconnect during an uncached model download. Confirm an actionable error or timeout, reconnect and retry successfully.
- [ ] Read a multi-sentence passage with commas, questions, quoted speech, numbers and abbreviations. Listen for intelligibility, natural phrasing and correct text coverage with both model engines.
- [ ] Import a teacher passage, review it, use short phrase breaks and a known writing pause. Test pause/resume/stop and the countdown during writing time.
- [ ] Toggle punctuation aloud off and on. Confirm a short pause before each spoken mark, the chosen writing pauses, and matching playback/WAV content.
- [ ] Download a WAV from each neural engine; open it in an independent audio player. Verify non-silent complete speech and the expected duration including the final dictation pause.
- [ ] Grant, deny and dismiss microphone permission in separate trials. Check that the microphone indicator tracks reality and no device remains active after stop, cancel or leaving the page.
- [ ] Record English speech and upload a short English audio file. Compare the resulting transcript with the source; test backgrounding and cancellation.
- [ ] Check keyboard navigation, visible focus, readable download/error messages, and the single settings panel at desktop and phone widths.
- [ ] Test a memory-limited mobile device. If neural generation is impractical, verify the installed-voice fallback is usable and that the UI does not promise unsupported accents.

Useful upstream references: [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Kokoro browser implementation](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), and [archived Supertonic implementation](https://github.com/supertone-oss-archive/supertonic).
