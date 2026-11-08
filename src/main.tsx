import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('[PWA] Service worker registration failed:', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
