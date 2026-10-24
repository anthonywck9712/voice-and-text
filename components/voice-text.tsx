'use client';
import { useState } from 'react';
import {
  AudioLines,
  ArrowUpRight,
  Headphones,
  LockKeyhole,
  LoaderCircle,
  Mic,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Volume2,
  NotebookPen,
  Hourglass,
  Download,
  Check,
} from 'lucide-react';
import { useSpeech } from '@/hooks/use-speech';
import { useTranscription } from '@/hooks/use-transcription';
import TranscriptionPanel from '@/components/transcription-panel';
import { useWebMCP } from '@/hooks/use-webmcp';
import DictationEditor from '@/components/dictation-editor';
import { dictationPhrases, phraseBreaks } from '@/lib/dictation';
import { accentName, SAMPLE_TEXT, wordCount } from '@/lib/text';
import { useBrowserVoice } from '@/hooks/use-browser-voice';
import AudioDownload from '@/components/audio-download';
import { useAudioDownload } from '@/hooks/use-audio-download';
import { useSiteConfig } from '@/hooks/use-site-config';
import { assetUrl } from '@/lib/assets';
import { neuralVoiceRequestId } from '@/lib/voice-options';
import { voiceModelState } from '@/lib/voice-model-state';
export default function VoiceText() {
  const [mode, setMode] = useState<'speak' | 'dictation' | 'transcribe'>(
    'speak',
  );
  const [text, setText] = useState('');
  const [dictationText, setDictationText] = useState('');
  const [writingPause, setWritingPause] = useState(8);
  const [readPunctuation, setReadPunctuation] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rate, setRate] = useState(1);
  const [help, setHelp] = useState(false);
  const [supertonicAccepted, setSupertonicAccepted] = useState(false);
  const neuralModel = useBrowserVoice();
  const site = useSiteConfig();
  const speech = useSpeech();
  const voice = speech.voices.find((v) => v.voiceURI === speech.voiceId);
  const audio = useTranscription();
  useWebMCP((value) => {
    if (exporting) throw new Error('Finish or cancel the audio file first.');
    if (importing)
      throw new Error('Finish or cancel the passage import first.');
    if (audio.phase !== 'idle')
      throw new Error(
        'Finish or cancel the current recording or transcription first.',
      );
    speech.stop();
    setText(value);
    setMode('speak');
  });
  const accents = [...new Set(speech.voices.map((v) => v.lang))];
  const active = speech.status !== 'idle';
  const preparing =
    speech.status === 'preparing' || speech.status === 'buffering';
  const neuralVoice = voice ? neuralVoiceRequestId(voice.voiceURI) : null;
  const isNeural = neuralVoice !== null;
  const isSupertonic = voice?.voiceURI.startsWith('neural:supertonic:');
  const licenceRequired = isSupertonic && !supertonicAccepted;
  const dictation = mode === 'dictation';
  const currentText = dictation ? dictationText : text;
  const setCurrentText = dictation ? setDictationText : setText;
  const download = useAudioDownload(
    mode !== 'transcribe' && neuralVoice
      ? {
          text: currentText,
          voice: neuralVoice,
          speed: rate,
          ...(dictation
            ? { dictationPause: writingPause, readPunctuation }
            : {}),
        }
      : null,
  );
  const exporting = download.phase === 'generating';
  const modelState = voiceModelState(
    neuralModel,
    isSupertonic ? 'supertonic' : 'kokoro',
    active || exporting,
  );
  const modelBusy = isNeural && modelState.busy;
  const modelReady = isNeural && modelState.ready;
  const phrases = dictationPhrases(dictationText);
  const words = wordCount(currentText);
  const writing = speech.status === 'writing';
  const phraseSession = speech.position.count > 0;
  const cannotStart =
    importing ||
    exporting ||
    licenceRequired ||
    currentText.length > site.maxTextLength ||
    (dictation && phrases.length > site.maxPhrases);
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="wordmark" aria-label="Voice & Text">
          <span className="brand-mark">
            <AudioLines size={25} strokeWidth={1.8} />
          </span>
          Voice <span className="ampersand">&</span> Text
        </div>
        <div className="header-actions">
          <span className="privacy-badge">
            <span className="status-dot" />
            On your device
          </span>
          <button
            className="icon-button"
            onClick={() => setHelp(!help)}
            aria-expanded={help}
            aria-label="Where your text is processed"
          >
            <ShieldCheck size={20} />
          </button>
        </div>
      </header>
      <main className={`studio ${mode !== 'transcribe' ? 'voice-studio' : ''}`}>
        <fieldset className="mode-switch" aria-label="Studio mode">
          <button
            disabled={audio.phase !== 'idle' || importing || exporting}
            aria-pressed={mode === 'speak'}
            className={mode === 'speak' ? 'selected' : ''}
            onClick={() => {
              speech.stop();
              setMode('speak');
            }}
          >
            <Volume2 size={18} />
            Text to voice
          </button>
          <button
            disabled={audio.phase !== 'idle' || importing || exporting}
            aria-pressed={dictation}
            className={dictation ? 'selected' : ''}
            onClick={() => {
              speech.stop();
              setMode('dictation');
            }}
          >
            <NotebookPen size={18} />
            Dictation
          </button>
          <button
            disabled={importing || exporting}
            aria-pressed={mode === 'transcribe'}
            className={mode === 'transcribe' ? 'selected' : ''}
            onClick={() => {
              speech.stop();
              setMode('transcribe');
            }}
          >
            <Mic size={18} />
            Voice to text
          </button>
        </fieldset>
        {help && (
          <aside className="help-panel">
            <LockKeyhole size={20} />
            <div>
              <strong>Your words stay on this device.</strong>
              <p>
                Neural voices and transcription run in your browser. A first-use
                download provides the speech models; your text, uploaded
                passages and recordings are not sent to a speech service.
                Installed voices are limited to voices that your browser
                identifies as local. Your browser caches models when storage is
                available. Save audio and transcripts before closing this page.
              </p>
            </div>
            <button className="text-button" onClick={() => setHelp(false)}>
              Close
            </button>
          </aside>
        )}
        <div className="page-heading">
          <div>
            <h1>
              {dictation
                ? 'Give every phrase room.'
                : mode === 'speak'
                  ? 'Let your words be heard.'
                  : 'Make room for your voice.'}
            </h1>
            <p>
              {dictation
                ? 'Read a phrase. Leave time to write. Continue at your class’s pace.'
                : mode === 'speak'
                  ? 'Choose a voice. Set the pace. Listen.'
                  : 'Record or open an audio file to turn speech into text.'}
            </p>
          </div>
          <span className="small-note">
            <LockKeyhole size={14} />
            Free · No account needed
          </span>
        </div>
        {mode !== 'transcribe' ? (
          <div className="workspace">
            <section
              className="settings-panel"
              aria-labelledby="voice-settings-title"
            >
              <div className="settings-heading">
                <h2 id="voice-settings-title">
                  <SlidersHorizontal size={18} />
                  Voice settings
                </h2>
                <span>
                  {
                    speech.voices.filter((v) =>
                      v.voiceURI.startsWith('neural:'),
                    ).length
                  }{' '}
                  free neural voices
                </span>
              </div>
              <div
                className={`settings-groups ${dictation ? 'with-dictation' : ''}`}
              >
                <div className="voice-choice-group settings-group">
                  <div className="voice-portrait">
                    <span className="voice-orb" aria-hidden="true">
                      <AudioLines size={23} strokeWidth={1.7} />
                    </span>
                    <div>
                      <strong>
                        {voice?.name ||
                          (speech.voicesLoaded
                            ? 'Choose a voice'
                            : 'Finding your voices…')}
                      </strong>
                      <span>
                        {voice
                          ? `${accentName(voice.lang)} · ${isNeural ? `${voice.engine || 'Neural'} voice` : 'Installed voice'}`
                          : 'English voices for your reading'}
                      </span>
                    </div>
                    <button
                      className="secondary-button preview-button"
                      disabled={
                        !voice ||
                        active ||
                        importing ||
                        exporting ||
                        licenceRequired
                      }
                      onClick={() =>
                        speech.speak(
                          'Hello. Take a moment to listen. This is how your text will sound.',
                          rate,
                        )
                      }
                    >
                      <Headphones size={16} />
                      Preview voice
                    </button>
                  </div>
                  <div className="voice-selects">
                    <div className="setting">
                      <label htmlFor="accent">English accent</label>
                      <select
                        id="accent"
                        disabled={!voice || active || importing || exporting}
                        value={voice?.lang || ''}
                        onChange={(e) =>
                          speech.setVoiceId(
                            speech.voices.find((v) => v.lang === e.target.value)
                              ?.voiceURI || '',
                          )
                        }
                      >
                        {!voice && (
                          <option value="">No voices available</option>
                        )}
                        {accents.map((lang) => (
                          <option key={lang} value={lang}>
                            {accentName(lang)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="setting">
                      <label htmlFor="voice">Voice</label>
                      <select
                        id="voice"
                        disabled={!voice || active || importing || exporting}
                        value={speech.voiceId}
                        onChange={(e) => speech.setVoiceId(e.target.value)}
                      >
                        {!voice && (
                          <option value="">No voices available</option>
                        )}
                        {speech.voices
                          .filter((v) => v.lang === voice?.lang)
                          .map((v) => (
                            <option key={v.voiceURI} value={v.voiceURI}>
                              {v.name}
                              {v.voiceURI.startsWith('neural:')
                                ? ` · ${v.engine || 'Neural'}`
                                : ' · Installed'}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                  <p className="settings-note">
                    {isNeural
                      ? `${voice?.character || 'Neural voice'}. Free speech generated on this device.`
                      : 'An installed voice, processed on your device. Extra accents depend on the voices installed in your system settings.'}
                  </p>
                </div>
                <div className="settings-group pace-group">
                  <h3>Reading pace</h3>
                  <div className="setting pace-setting">
                    <div className="label-row">
                      <label htmlFor="pace">Reading speed</label>
                      <output htmlFor="pace">
                        {rate.toFixed(2).replace(/0$/, '')}×
                      </output>
                    </div>
                    <input
                      id="pace"
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      disabled={active || importing || exporting}
                      value={rate}
                      aria-describedby="pace-help"
                      onChange={(e) => setRate(Number(e.target.value))}
                    />
                    <div className="range-labels" aria-hidden="true">
                      <span>Slower</span>
                      <span>Faster</span>
                    </div>
                  </div>
                  <p className="settings-note" id="pace-help">
                    {dictation
                      ? 'How quickly each phrase is spoken. Writing time is added separately.'
                      : 'Applies to your preview, reading and audio download.'}
                  </p>
                </div>
                {dictation && (
                  <div className="settings-group dictation-settings">
                    <h3>Dictation</h3>
                    <div className="label-row">
                      <label htmlFor="writing-pause">Time to write</label>
                      <output htmlFor="writing-pause">
                        {writingPause} sec
                      </output>
                    </div>
                    <input
                      id="writing-pause"
                      type="range"
                      min={3}
                      max={30}
                      step={1}
                      value={writingPause}
                      disabled={active || importing || exporting}
                      aria-describedby="writing-pause-help"
                      onChange={(e) => setWritingPause(Number(e.target.value))}
                    />
                    <p id="writing-pause-help" className="settings-note">
                      Silence after every phrase, including the last.
                    </p>
                    <div
                      className={`punctuation-setting ${readPunctuation ? 'is-enabled' : ''}`}
                    >
                      <label htmlFor="read-punctuation">
                        <input
                          id="read-punctuation"
                          type="checkbox"
                          checked={readPunctuation}
                          disabled={active || importing || exporting}
                          onChange={(e) => setReadPunctuation(e.target.checked)}
                          aria-describedby="punctuation-help"
                        />
                        <span>Read punctuation aloud</span>
                      </label>
                      <p id="punctuation-help">
                        Briefly pause before saying “comma”, “full stop” and
                        other marks. Included in audio downloads.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {isNeural && (
                <div
                  className={`model-strip voice-model-strip ${modelReady ? 'model-ready' : ''}`}
                >
                  <span className="model-icon" aria-hidden="true">
                    {modelBusy ? (
                      <LoaderCircle className="spin" size={20} />
                    ) : modelReady ? (
                      <Check size={20} />
                    ) : (
                      <Download size={20} />
                    )}
                  </span>
                  <div className="model-copy">
                    <strong aria-live="polite">
                      {modelBusy
                        ? modelState.downloading
                          ? 'Downloading your voice model…'
                          : 'Starting your voice model…'
                        : modelReady
                          ? 'Voice model ready on this device'
                          : 'Download once. Read on your device.'}
                    </strong>
                    <p>
                      {modelBusy
                        ? modelState.downloading
                          ? `${(modelState.bytes / 1048576).toFixed(1)} MB downloaded${modelState.total ? ` of ${(modelState.total / 1048576).toFixed(1)} MB` : ''}. Keep this page open.`
                          : 'Preparing the model in your browser. The first use can take longer.'
                        : modelReady
                          ? 'Your text stays here. Generation speed depends on this device.'
                          : `${isSupertonic ? 'Supertonic needs about 400 MB on first use. ' : 'The first reading downloads the voice model. '}Your browser caches it when storage is available. Models load only when you play or create audio.`}
                    </p>
                    {modelBusy && (
                      <progress
                        className="voice-model-progress"
                        aria-label="Voice model download progress"
                        max={1}
                        value={
                          modelState.downloading
                            ? modelState.progress
                            : undefined
                        }
                      />
                    )}
                  </div>
                </div>
              )}
              {isSupertonic && (
                <div className="voice-licence">
                  <label>
                    <input
                      type="checkbox"
                      checked={supertonicAccepted}
                      disabled={active || exporting}
                      onChange={(event) =>
                        setSupertonicAccepted(event.target.checked)
                      }
                    />
                    <span>
                      I agree to the{' '}
                      <a
                        href={assetUrl('licenses/supertonic-model.txt')}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Supertonic model licence
                      </a>
                      .
                    </span>
                  </label>
                  <p>Audio is AI-generated. Share it as synthetic speech.</p>
                </div>
              )}
              {speech.voicesLoaded && !voice && (
                <output className="inline-error">
                  No English voices were found. Download one in your device’s
                  speech or accessibility settings, then reopen this page.
                </output>
              )}
            </section>
            <section className="editor-panel" aria-label="Text to read aloud">
              <div className="panel-heading">
                <label htmlFor="source-text">
                  {dictation ? 'Dictation phrases' : 'Your text'}
                </label>
                <button
                  className="text-button"
                  disabled={active || importing || exporting}
                  onClick={() =>
                    setCurrentText(
                      dictation ? phraseBreaks(SAMPLE_TEXT) : SAMPLE_TEXT,
                    )
                  }
                >
                  Try a sample
                  <ArrowUpRight size={15} />
                </button>
              </div>
              {dictation ? (
                <DictationEditor
                  value={dictationText}
                  onChange={setDictationText}
                  active={active || exporting}
                  onImporting={setImporting}
                />
              ) : (
                <textarea
                  id="source-text"
                  className="source-text"
                  placeholder="Type or paste something you’d like to hear…"
                  value={text}
                  onChange={(e) => {
                    speech.stop();
                    setText(e.target.value);
                  }}
                  maxLength={site.maxTextLength}
                  spellCheck
                  readOnly={active || exporting}
                />
              )}
              <div className="editor-meta">
                <span>
                  {words} {words === 1 ? 'word' : 'words'}
                  <span className="meta-separator" />
                  {currentText.length.toLocaleString()} /{' '}
                  {site.maxTextLength.toLocaleString()} characters
                  {dictation && (
                    <span className="phrase-count">
                      {phrases.length} phrases
                    </span>
                  )}
                </span>
                <button
                  className="icon-button"
                  aria-label="Clear text"
                  disabled={!currentText || active || importing || exporting}
                  onClick={() => setCurrentText('')}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
              {currentText.length > site.maxTextLength && (
                <p className="import-error" role="alert">
                  This site accepts up to {site.maxTextLength.toLocaleString()}{' '}
                  characters per reading. Split the passage into shorter
                  sections.
                </p>
              )}
              {dictation && phrases.length > site.maxPhrases && (
                <p className="import-error" role="alert">
                  Use up to {site.maxPhrases} phrases. Join short lines or split
                  the passage.
                </p>
              )}
              {dictation && active && phraseSession && (
                <div
                  className={`dictation-live ${writing ? 'is-writing' : ''}`}
                >
                  {writing ? (
                    <Hourglass size={18} />
                  ) : (
                    <NotebookPen size={18} />
                  )}
                  <div>
                    <strong>
                      {writing
                        ? 'Time for students to write'
                        : speech.status === 'paused'
                          ? 'Dictation paused'
                          : 'Current phrase'}
                    </strong>
                    <p>{phrases[speech.position.phrase - 1]?.text}</p>
                  </div>
                  {(writing ||
                    (speech.status === 'paused' &&
                      speech.position.remaining > 0)) && (
                    <span
                      className="writing-countdown"
                      aria-label={`${speech.position.remaining} seconds of writing time remaining`}
                    >
                      {speech.position.remaining}
                      <small>sec</small>
                    </span>
                  )}
                </div>
              )}
              <div className="transport">
                <button
                  className="play-button"
                  aria-label={
                    active && speech.status !== 'paused'
                      ? 'Pause reading'
                      : speech.status === 'paused'
                        ? 'Resume reading'
                        : dictation
                          ? 'Start dictation'
                          : 'Read text aloud'
                  }
                  disabled={
                    !voice || (!active && (!currentText.trim() || cannotStart))
                  }
                  onClick={() =>
                    active
                      ? speech.togglePause()
                      : speech.speak(
                          currentText,
                          rate,
                          dictation
                            ? { dictationPause: writingPause, readPunctuation }
                            : {},
                        )
                  }
                >
                  {preparing ? (
                    <LoaderCircle size={23} className="spin" />
                  ) : speech.status === 'speaking' || writing ? (
                    <Pause size={23} fill="currentColor" />
                  ) : (
                    <Play size={23} fill="currentColor" />
                  )}
                </button>
                <div className="transport-content">
                  <div className="transport-label">
                    <strong aria-live="polite">
                      {speech.status === 'preparing'
                        ? modelBusy && modelState.downloading
                          ? 'Downloading your voice…'
                          : 'Preparing your voice…'
                        : speech.status === 'buffering'
                          ? 'Buffering the next sentence…'
                          : writing
                            ? 'Writing time'
                            : speech.status === 'speaking'
                              ? 'Reading aloud'
                              : speech.status === 'paused'
                                ? 'Reading paused'
                                : speech.progress === 1
                                  ? dictation && phraseSession
                                    ? 'Dictation complete'
                                    : 'Finished reading'
                                  : 'Ready when you are'}
                    </strong>
                    <span>
                      {speech.status === 'preparing'
                        ? modelBusy
                          ? 'First-use setup'
                          : 'On this device'
                        : active
                          ? phraseSession
                            ? `Phrase ${speech.position.phrase} of ${speech.position.count}`
                            : `${Math.round(speech.progress * 100)}%`
                          : dictation
                            ? `${writingPause}s writing pauses`
                            : 'Text to voice'}
                    </span>
                  </div>
                  <progress
                    className="reading-progress"
                    aria-label="Reading progress"
                    value={speech.progress}
                    max={1}
                  />
                </div>
                <button
                  className="stop-button"
                  disabled={!active}
                  onClick={speech.stop}
                  aria-label="Stop reading"
                >
                  <Square size={17} fill="currentColor" />
                </button>
              </div>
              <AudioDownload
                audio={download}
                disabled={
                  active || cannotStart || !currentText.trim() || !voice
                }
                supported={Boolean(isNeural)}
                dictation={dictation}
                readPunctuation={dictation && readPunctuation}
                voiceId={speech.voiceId}
              />
            </section>
          </div>
        ) : (
          <TranscriptionPanel audio={audio} />
        )}
        {speech.error && (
          <div role="alert" className="inline-error">
            {speech.error}
          </div>
        )}
        <footer className="studio-footer">
          <span>
            <ShieldCheck size={15} />
            Speech and transcription stay on this device.
          </span>
          <span>
            English voice studio
            <span className="footer-divider" />
            Voice & Text
          </span>
        </footer>
      </main>
    </div>
  );
}
