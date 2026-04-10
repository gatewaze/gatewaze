/**
 * pdfjs-dist worker setup.
 *
 * This file lives inside the admin package (not an external module) so that
 * Vite's `?url` asset import resolves correctly. When external modules later
 * dynamically `import('pdfjs-dist')`, Vite's `dedupe` returns the same module
 * instance — so the workerSrc we set here is already in place.
 *
 * Imported as a side-effect from main.tsx.
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
