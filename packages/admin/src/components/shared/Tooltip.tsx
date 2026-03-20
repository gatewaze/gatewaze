// Import Dependencies
import { Tooltip } from "react-tooltip";

// Local Import
import {
  injectStyles,
  insertStylesToHead,
  makeStyleTag
} from "@/utils/dom/injectStylesToHead";

// ----------------------------------------------------------------------

const css = `
:root {
  --rt-color-white: #fff;
  --rt-color-dark: var(--color-gray-800) !important;
  --rt-color-success: var(--color-success-darker) !important;
  --rt-color-error: var(--color-error-darker) !important;
  --rt-color-warning: var(--color-warning-darker) !important;
  --rt-color-info: var(--color-info-darker) !important;
  --rt-opacity: 1;
  --rt-transition-show-delay: 0.15s;
  --rt-transition-closing-delay: 0.15s;
}

:root.dark {
  --rt-color-white: var(--color-dark-50) !important;
  --rt-color-dark: var(--color-dark-500) !important;
}`;

const sheet = makeStyleTag();

injectStyles(sheet, css);
insertStylesToHead(sheet);

export { Tooltip };
