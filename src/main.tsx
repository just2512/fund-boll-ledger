import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './native.css';

// Only the browser PWA uses the Service Worker. Native app URLs are handled by Tauri.
const isBrowserPwaOrigin =
  window.location.protocol === 'https:' ||
  (window.location.protocol === 'http:' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'));

if ('serviceWorker' in navigator && import.meta.env.PROD && isBrowserPwaOrigin) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((error) => console.error('Service worker registration failed', error));
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
