import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import './VoiceGuidance.js';

(window as unknown as { VoiceGuide: { init: (o: object) => void } }).VoiceGuide.init({
  content: '#root',
  settings: { engine: 'browser' },
});

import './qr/qr-scanner.js';
