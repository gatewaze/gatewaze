/**
 * Platform-wide sanitisation entry point. Per spec-sites-wysiwyg-builder §7.1.
 */

// Drop the `.js` extension: portal's Next webpack picks up @gatewaze/shared
// from source via tsconfig paths + transpilePackages, and its resolver
// throws `Module not found: Can't resolve './dompurify-config.js'` at
// `next build`. admin/api builds via tsc accept either form, so
// extension-less is the lowest-friction shape across consumers.
export {
  sanitiseHtmlField,
  sanitiseTrustedHtmlField,
  sanitiseDocument,
  DOMPURIFY_HTML_ALLOWED_TAGS,
  DOMPURIFY_HTML_ALLOWED_ATTR,
  DOMPURIFY_TRUSTED_HTML_ALLOWED_TAGS,
  DOMPURIFY_TRUSTED_HTML_ALLOWED_ATTR,
} from './dompurify-config';
