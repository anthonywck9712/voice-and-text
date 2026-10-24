import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import './app/globals.css';
import VoiceText from './components/voice-text';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VoiceText />
  </React.StrictMode>,
);
