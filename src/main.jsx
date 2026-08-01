import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import LifecycleDiagnosticsPanel from './components/debug/LifecycleDiagnosticsPanel.tsx'
import './index.css'
import 'katex/dist/katex.min.css'
import {
  initializeLifecycleDiagnostics,
  recordLifecycleDiagnostic,
  recordServiceWorkerRegistration,
} from './utils/lifecycleDiagnostics'

// Initialize i18n
import './i18n/config.js'

initializeLifecycleDiagnostics();

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(registration => {
      recordServiceWorkerRegistration(registration, 'main');
    })
    .catch(err => {
      recordLifecycleDiagnostic('service-worker.registration-failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      console.warn('Service worker registration failed:', err);
    });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <LifecycleDiagnosticsPanel />
  </React.StrictMode>,
)
