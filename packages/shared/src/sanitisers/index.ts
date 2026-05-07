/**
 * Platform-wide sanitisation entry point. Per spec-sites-wysiwyg-builder §7.1.
 */

export {
  sanitiseHtmlField,
  sanitiseTrustedHtmlField,
  sanitiseDocument,
  DOMPURIFY_HTML_ALLOWED_TAGS,
  DOMPURIFY_HTML_ALLOWED_ATTR,
  DOMPURIFY_TRUSTED_HTML_ALLOWED_TAGS,
  DOMPURIFY_TRUSTED_HTML_ALLOWED_ATTR,
} from './dompurify-config.js';
