# Speech model and runtime notices

## Kokoro

The 28 American and British neural presets use Kokoro-82M-v1.0 and Kokoro.js.
Model: <https://huggingface.co/hexgrad/Kokoro-82M> (Apache-2.0).
Browser weights: <https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX>.
Code: <https://github.com/hexgrad/kokoro/tree/main/kokoro.js> (Apache-2.0).

## Supertonic 3

The ten additional presets F1–F5 and M1–M5 are the publisher's supplied voice
styles. They support English; no regional accent is claimed. There is no paid
account, API request, or Azure subscription. Speech is generated on the visitor's
device. First use downloads approximately 398 MB of model weights plus small
configuration and selected voice-style files from Hugging Face; the browser
caches these when storage is available. This is separate from the Kokoro download.

The project was archived in September 2026. We pin its last documented model
snapshot and retain its licenses; no ongoing upstream support is promised.

- Official source: <https://github.com/supertone-oss-archive/supertonic>
- Source snapshot: `1e9799e964ea4c0dad7cde993b65c3c813a7b373`
- Model: <https://huggingface.co/supertone-oss-archive/supertonic-3>
- Model snapshot: `aafc6e32416a594460b32413efc49d7fe4ce6d46`
- Presets: `voice_styles/F1.json` through `F5.json` and `M1.json` through `M5.json`
- Model and preset license: [BigScience Open RAIL-M](public/licenses/supertonic-model.txt)
- Adapted example code license: [MIT](public/licenses/supertonic-code.txt), Copyright (c) 2025 Supertone Inc.

`lib/supertonic-engine.ts` and the normalization in `lib/supertonic-model.ts`
are modified adaptations of the official browser example. Changes include typed
arrays for single-utterance inference, pinned downloads and cache handling,
progress reporting, bounded allocations, tensor/session cleanup, and integration
with Voice & Text's phrase and punctuation playback.

Use of the Supertonic model is governed by the complete linked Open RAIL-M
license, including its Section 5 and Attachment A use restrictions. The model
license applies to this application's users. The selected-model agreement links
to the complete license before enabling Supertonic generation. When distributing
its audio, disclose intelligibly that the speech is AI-generated, as required by
the model license. The source and model have separate licenses.

## Browser inference runtime

ONNX Runtime Web is MIT-licensed: <https://github.com/microsoft/onnxruntime>.
Transformers.js is Apache-2.0-licensed: <https://github.com/huggingface/transformers.js>.
Runtime version pins and asset preparation are recorded in `package-lock.json`
and `scripts/prepare-assets.mjs`. Model inference uses a Web Worker; the website
never sends the user's reading text to a speech API.
