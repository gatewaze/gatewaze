import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

import "./i18n/config";
import "./utils/setupEvents";
import "./utils/validateEventsData";
import { setupFavicon } from './utils/favicon';

import "simplebar-react/dist/simplebar.min.css";

import "./styles/index.css";

// Setup brand-specific favicon and title
setupFavicon();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
