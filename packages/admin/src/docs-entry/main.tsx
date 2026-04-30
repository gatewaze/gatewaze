import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@scalar/api-reference-react/style.css';
import './styles.css';
import { DocsApp } from './DocsApp';

// Vite entry-point: mount the docs root. All component definitions live
// in ./DocsApp so this file has no component exports — react-refresh
// fast refresh requires entry files to be mount-only or component-only.
createRoot(document.getElementById('docs-root')!).render(
  <StrictMode>
    <DocsApp />
  </StrictMode>
);
