'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NEURAL_VOICES, speechChunks } from '@/lib/text';
import {
  availableEnglishVoices,
  neuralVoiceRequestId,
} from '@/lib/voice-options';
import { NeuralPlayer, type ReadingStatus } from '@/lib/neural-player';
import { SystemDictationPlayer } from '@/lib/system-dictation-player';
import {
  EMPTY_POSITION,
  dictationPhrases,
  MAX_PHRASES,
  type ReadingOptions,
  type PhrasePosition,
} from '@/lib/dictation';

export function useSpeech() {
  const [voices, setVoices] = useState(availableEnglishVoices);
  const [voiceId, setVoiceId] = useState(NEURAL_VOICES[0].voiceURI);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [status, setStatus] = useState<ReadingStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [position, setPosition] = useState<PhrasePosition>(EMPTY_POSITION);
  const generation = useRef(0);
  const neural = useRef<NeuralPlayer | null>(null);
  const systemDictation = useRef<SystemDictationPlayer | null>(null);
  const utterances = useRef<SpeechSynthesisUtterance[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    neural.current?.stop();
    neural.current = null;
    systemDictation.current?.stop();
    systemDictation.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    }
    utterances.current = [];
    setStatus('idle');
    setProgress(0);
    setPosition(EMPTY_POSITION);
  }, []);
  useEffect(() => {
    const synth = window.speechSynthesis;
    const update = () => {
      setVoices(availableEnglishVoices(synth?.getVoices() || []));
      setVoicesLoaded(true);
    };
    queueMicrotask(update);
    synth?.addEventListener('voiceschanged', update);
    window.addEventListener('pagehide', stop);
    return () => {
      synth?.removeEventListener('voiceschanged', update);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [stop]);
  const speak = (text: string, rate: number, options: ReadingOptions = {}) => {
    stop();
    setError('');
    const voice = voices.find((v) => v.voiceURI === voiceId);
    if (!voice || !text.trim()) return;
    if (
      options.dictationPause !== undefined &&
      dictationPhrases(text).length > MAX_PHRASES
    ) {
      setError(
        'Use up to 400 phrases in one dictation. Join short lines or split the lesson.',
      );
      return;
    }
    const token = generation.current;
    const fail = (message: string) => {
      if (token === generation.current) {
        stop();
        setError(message);
      }
    };
    const updatePosition = (value: PhrasePosition) => {
      if (token === generation.current) setPosition(value);
    };
    const neuralVoice = neuralVoiceRequestId(voice.voiceURI);
    if (neuralVoice) {
      try {
        const player = new NeuralPlayer(
          (value) => {
            if (token === generation.current) setStatus(value);
          },
          (value) => {
            if (token === generation.current) setProgress(value);
          },
          updatePosition,
        );
        neural.current = player;
        void player
          .play(text, neuralVoice, rate, options)
          .catch((error) =>
            fail(
              error.name === 'AbortError' || error instanceof TypeError
                ? 'The voice could not load. Check your internet connection for the first download, then press Play to retry. On a device with limited memory, close other tabs or choose an installed voice.'
                : error.message || 'The voice could not play. Please retry.',
            ),
          );
      } catch {
        fail(
          'Audio could not start. Try Chrome or Safari and check your output device.',
        );
      }
      return;
    }
    if (options.dictationPause !== undefined) {
      const player = new SystemDictationPlayer(
        voice.systemVoice!,
        (value) => {
          if (token === generation.current) setStatus(value);
        },
        (value) => {
          if (token === generation.current) setProgress(value);
        },
        updatePosition,
        fail,
      );
      systemDictation.current = player;
      player.play(text, rate, options.dictationPause, options.readPunctuation);
      return;
    }
    // Queue whole sentence groups before playback. The native engine owns timing.
    const chunks = speechChunks(text, 1600);
    setStatus('speaking');
    utterances.current = chunks.map((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk.text);
      utterance.voice = voice.systemVoice!;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      utterance.onstart = () => {
        if (token === generation.current && timer.current)
          clearTimeout(timer.current);
      };
      utterance.onboundary = (e) => {
        if (token === generation.current)
          setProgress((chunk.offset + e.charIndex) / text.length);
      };
      utterance.onend = () => {
        if (token !== generation.current) return;
        setProgress((chunk.offset + chunk.text.length) / text.length);
        if (index === chunks.length - 1) {
          setStatus('idle');
          setProgress(1);
          utterances.current = [];
        }
      };
      utterance.onerror = (e) => {
        if (!['canceled', 'interrupted'].includes(e.error))
          fail(
            'The installed voice could not play. Choose a neural voice or another installed voice and try again.',
          );
      };
      return utterance;
    });
    timer.current = setTimeout(
      () =>
        fail(
          'Playback did not start. Click Play again or select a neural voice.',
        ),
      12000,
    );
    for (const utterance of utterances.current)
      window.speechSynthesis.speak(utterance);
  };
  const togglePause = () => {
    if (systemDictation.current) {
      systemDictation.current.togglePause();
      return;
    }
    if (neural.current) {
      const token = generation.current;
      void neural.current.togglePause().catch(() => {
        if (token === generation.current) {
          stop();
          setError('Playback could not resume. Press Play to restart.');
        }
      });
    } else if (status === 'speaking') {
      if (timer.current) clearTimeout(timer.current);
      window.speechSynthesis.pause();
      setStatus('paused');
    } else if (status === 'paused') {
      window.speechSynthesis.resume();
      setStatus('speaking');
    }
  };
  return {
    voices,
    voiceId,
    setVoiceId,
    voicesLoaded,
    status,
    progress,
    error,
    position,
    speak,
    stop,
    togglePause,
  };
}
