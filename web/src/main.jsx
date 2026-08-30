import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.jsx';

// Order matters: tokens define the palette, base resets and sets the defaults,
// and the rest layer on top of both.
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/bottle.css';
import './styles/letter.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
