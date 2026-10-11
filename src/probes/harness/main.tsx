import React from 'react';
import ReactDOM from 'react-dom/client';

import '../../index.css';
import '../../i18n/config.js';

import ProbeApp from './ProbeApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProbeApp />
  </React.StrictMode>,
);
