import { localEnglishVoices, NEURAL_VOICES } from './text.ts';

export type VoiceOption = {
  voiceURI: string;
  name: string;
  lang: string;
  character?: string;
  engine?: string;
  systemVoice?: SpeechSynthesisVoice;
};

/** Only the published free catalog can route to browser model inference. */
export function neuralVoiceRequestId(voiceURI: string) {
  return NEURAL_VOICES.some((voice) => voice.voiceURI === voiceURI)
    ? voiceURI.slice('neural:'.length)
    : null;
}

export function availableEnglishVoices(
  installed: SpeechSynthesisVoice[] = [],
): VoiceOption[] {
  return [
    ...NEURAL_VOICES,
    ...localEnglishVoices(installed).map((voice) => ({
      voiceURI: voice.voiceURI,
      name: voice.name,
      lang: voice.lang.replaceAll('_', '-'),
      systemVoice: voice,
    })),
  ];
}
