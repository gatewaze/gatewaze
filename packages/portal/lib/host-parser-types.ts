// Shape of a row from the existing `custom_domains` module that
// host-parser.ts handles.
//
// Kept as a small standalone shape (rather than re-exporting from the
// custom-domains module) so host-parser.ts has zero runtime dependency
// on the wider supabase client surface — the parser is unit-testable
// in isolation.

export interface CustomDomainRow {
  contentType: string
  contentSlug: string
  contentId: string
  pageTitle?: string
  faviconUrl?: string
}
