# Technical Specification: Structured Resources Module

## Overview / Context

Gatewaze is a modular, extensible platform with an admin app (React 19 + Vite), a public portal (Next.js 15 App Router), an API server (Express), and PostgreSQL via Supabase. The module system allows features to be developed as self-contained packages that register admin routes, portal routes, API routes, database migrations, and navigation items.

The **Structured Resources** module introduces a premium content management feature for the portal. It allows administrators to create and manage hierarchical content organized as **collections > categories > items > sections**, where each item contains multiple rich-text sections under configurable headings. Authentication gating is configurable — administrators can choose whether content requires login or is publicly accessible, both at the module level (global default) and per collection. This makes it suitable for both gated knowledge bases and public resource guides, toolkits, and reference libraries.

The reference use case is a curated guide to open-source AI/ML tools, organized by function (e.g., "Agent reliability and testing", "Observability and debugging"), where each tool has structured subsections ("The problem", "The solution", "How it works", "Possible use cases", "Trade-offs and limits"). However, the module is generic and supports any structured content domain.

## Goals and Non-Goals

### Goals

1. Provide a hierarchical content management system: collections > categories > items > sections
2. Support configurable section templates per collection so different resource collections can have different section structures
3. Full CRUD administration through the admin app with rich-text editing
4. Configurable authentication gating — admin chooses whether content requires login (module-level default + per-collection override)
5. Premium module visibility (`visibility: 'premium'`) in the module registry
6. Ordering support for categories, items, and sections
7. Search and filtering on the portal side
8. Markdown import capability for bulk content loading
9. SEO metadata support at the collection and item levels
10. Mobile-responsive portal rendering

### Non-Goals

1. Role-based access control per collection/category/item — access is either public or authenticated, not per-role
2. Versioning or revision history of content — not in v1
3. User-generated content or comments — admin-only authoring
4. Real-time collaborative editing
5. Internationalization / multi-language content — not in v1
6. Payment integration — premium gating is at the module level, not per-content
7. RSS feeds or external syndication

## System Architecture

### Module Registration

```
structured-resources/
├── index.ts                          # GatewazeModule export
├── package.json
├── migrations/
│   └── 001_structured_resources.sql  # All tables, RLS policies, indexes
├── admin/
│   ├── pages/
│   │   ├── collections/
│   │   │   └── index.tsx             # Collection list + CRUD
│   │   ├── collection/
│   │   │   └── index.tsx             # Single collection: categories, items, sections
│   │   └── import/
│   │       └── index.tsx             # Markdown import tool
│   └── utils/
│       └── structuredResourcesService.ts  # Service layer
└── portal/
    └── pages/
        ├── index.tsx                 # Collection listing (auth-gated)
        ├── _collectionSlug/
        │   ├── index.tsx             # Category listing within collection
        │   └── _itemSlug.tsx         # Item detail with all sections
        └── components/
            ├── AuthGate.tsx           # Auth check wrapper
            ├── CategoryAccordion.tsx   # Expandable category view
            ├── ItemCard.tsx            # Item preview card
            ├── SectionRenderer.tsx     # Rich content section renderer
            └── SearchFilter.tsx        # Search and category filter
```

### Component Interaction

```
Portal User → Next.js Middleware (rewrite /resources → /m/resources)
              Note: /m/ prefix is a Gatewaze platform convention — the middleware
              rewrites module portal paths to an internal /m/ directory so module
              page components are loaded from the module's portal/pages/ directory.
              The user-facing URL remains /resources.
           → AuthGate (check Supabase session, resolve collection access level)
           → Server Component (fetch from Supabase — anon client for public, authenticated for gated)
           → Render structured content

Admin User → React Router (FeatureGuard: 'structured-resources')
          → Admin Pages (CRUD via service layer)
          → Supabase authenticated client (RLS policies enforce is_admin() check)
```

## Component Design

### Module Definition (`index.ts`)

```typescript
const structuredResourcesModule: GatewazeModule = {
  id: 'structured-resources',
  type: 'feature',
  visibility: 'premium',
  name: 'Structured Resources',
  description: 'Create and manage authentication-gated, hierarchical resource guides with configurable section templates',
  version: '1.0.0',
  features: [
    'structured-resources',
    'structured-resources.collections',
    'structured-resources.import',
  ],

  migrations: ['migrations/001_structured_resources.sql'],

  adminRoutes: [
    {
      path: 'structured-resources/collections',
      component: () => import('./admin/pages/collections/index'),
      requiredFeature: 'structured-resources',
      guard: 'none',
    },
    {
      path: 'structured-resources/collections/:id',
      component: () => import('./admin/pages/collection/index'),
      requiredFeature: 'structured-resources',
      guard: 'none',
    },
    {
      path: 'structured-resources/import',
      component: () => import('./admin/pages/import/index'),
      requiredFeature: 'structured-resources.import',
      guard: 'admin',
    },
  ],

  adminNavItems: [
    {
      path: '/structured-resources/collections',
      label: 'Resources',
      icon: 'Library',
      requiredFeature: 'structured-resources',
      order: 18,
    },
  ],

  portalNav: {
    label: 'Resources',
    path: '/resources',
    icon: 'book-open',
    order: 25,
  },

  portalRoutes: [
    { path: '/resources', component: () => import('./portal/pages/index') },
    { path: '/resources/:collectionSlug', component: () => import('./portal/pages/_collectionSlug/index') },
    { path: '/resources/:collectionSlug/:itemSlug', component: () => import('./portal/pages/_collectionSlug/_itemSlug') },
  ],

  configSchema: {
    default_access: {
      type: 'select',
      label: 'Default content access',
      default: 'authenticated',
      options: ['public', 'authenticated'],
      description: 'Default access level for new collections. "public" = anyone can view, "authenticated" = login required. Individual collections can override this.',
    },
    show_teaser: {
      type: 'boolean',
      label: 'Show teaser to unauthenticated users',
      default: true,
      description: 'When a collection requires auth, show collection titles and descriptions to unauthenticated users with a sign-in prompt instead of hiding entirely',
    },
  },

  onInstall: async () => {
    console.log('[structured-resources] Module installed');
  },
  onEnable: async () => {
    console.log('[structured-resources] Module enabled');
  },
  onDisable: async () => {
    console.log('[structured-resources] Module disabled');
  },
};
```

### Admin Pages

#### Collections List Page
- Data table listing all collections with name, slug, status, category count, item count, created date
- Create/edit modal with fields: name, slug (auto-generated), description, status, access (public/authenticated/inherit — "inherit" uses module default), cover_image_url, meta_title, meta_description
- Section template editor: define the default section headings for items in the collection (e.g., "The problem", "The solution", "How it works", "In more depth", "Possible use cases", "Trade-offs and limits")
- Delete with confirmation (cascades to categories, items, sections)

#### Collection Detail Page
- Tabbed interface: Categories | Items | Section Templates | Settings
- **Categories tab**: Drag-and-drop reorderable list, inline create/edit, fields: name, slug, description, icon, sort_order
- **Items tab**: Filterable by category, create/edit form with: title, slug, subtitle, category, external_url, featured_image_url, sort_order, status. Section content editor with one rich-text field per section template entry.
- **Section Templates tab**: Manage the section headings for this collection. Reorderable. Each template entry: heading, description (helper text for editors), is_required flag.
- **Settings tab**: Collection-level config overrides

#### Import Page
- Upload or paste markdown content
- Parser detects H2 as categories, H3 as items, H4/bold headings as section breaks
- Preview parsed structure before import
- Map detected sections to collection's section templates. For unmatched headings (detected heading has no matching template), the admin can: (a) map it to an existing template, (b) create a new section template entry for the collection using the detected heading, or (c) discard the unmapped section content. Default behavior: create new template.
- Create target collection or import into existing

### Portal Pages

#### Collection Listing (`/resources`)
- Fetch all published collections
- For each collection, resolve its effective access level: if `access = 'inherit'`, use the module-level `default_access` config; otherwise use the collection's own `access` value
- Public collections are shown fully to all visitors
- Authenticated-only collections: if user is logged in, show normally; if not and `show_teaser` is enabled, show collection card with blurred content and sign-in CTA; if `show_teaser` is disabled, hide entirely
- Grid of collection cards showing name, description, cover image, category count, item count, and a lock icon badge on auth-gated collections

#### Collection Detail (`/resources/:collectionSlug`)
- Breadcrumb navigation: Resources > Collection Name
- Collection header with description
- Category sidebar/filter on desktop, dropdown on mobile
- Items displayed as cards within their categories
- Search bar filtering items by title, subtitle, and section content
- Category filter (click category in sidebar to filter)

#### Item Detail (`/resources/:collectionSlug/:itemSlug`)
- Breadcrumb: Resources > Collection > Category > Item
- Item header: title, subtitle, external URL link, featured image
- Table of contents generated from section headings
- Sections rendered sequentially with heading and rich HTML content
- Previous/next navigation within the category
- Back to collection link

## API Design

No dedicated Express API routes are needed for v1. All data access goes through Supabase client directly from admin (authenticated) and portal (authenticated for reads). The Supabase RLS policies enforce access control at the database level.

If API routes are needed in the future (e.g., for external integrations or webhooks), they can be added via the `apiRoutes` module export.

## Data Models / Database Schema

### Tables

```sql
-- ============================================================
-- Collections: top-level resource groupings
-- ============================================================
CREATE TABLE public.sr_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  access TEXT NOT NULL DEFAULT 'inherit' CHECK (access IN ('public', 'authenticated', 'inherit')),
  meta_title TEXT,
  meta_description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sr_collections_slug ON public.sr_collections(slug);
CREATE INDEX idx_sr_collections_status ON public.sr_collections(status);
CREATE INDEX idx_sr_collections_access ON public.sr_collections(access);

-- ============================================================
-- Section Templates: define expected sections per collection
-- ============================================================
CREATE TABLE public.sr_section_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES public.sr_collections(id) ON DELETE CASCADE,
  heading TEXT NOT NULL,
  description TEXT,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collection_id, heading)
);

CREATE INDEX idx_sr_section_templates_collection ON public.sr_section_templates(collection_id);

-- ============================================================
-- Categories: groupings within a collection
-- ============================================================
CREATE TABLE public.sr_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES public.sr_collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collection_id, slug)
);

CREATE INDEX idx_sr_categories_collection ON public.sr_categories(collection_id);

-- ============================================================
-- Items: individual resources within a category
-- ============================================================
CREATE TABLE public.sr_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES public.sr_collections(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.sr_categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  subtitle TEXT,
  external_url TEXT,
  featured_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collection_id, slug)
);

CREATE INDEX idx_sr_items_collection ON public.sr_items(collection_id);
CREATE INDEX idx_sr_items_category ON public.sr_items(category_id);
CREATE INDEX idx_sr_items_status ON public.sr_items(status);

-- Full-text search: stored tsvector column on items (title + subtitle)
ALTER TABLE public.sr_items ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(subtitle, '')), 'B')
  ) STORED;
CREATE INDEX idx_sr_items_search ON public.sr_items USING GIN(search_vector);

-- ============================================================
-- Sections: content blocks within an item
-- ============================================================
CREATE TABLE public.sr_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.sr_items(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.sr_section_templates(id) ON DELETE SET NULL,
  heading TEXT NOT NULL,
  content TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sr_sections_item ON public.sr_sections(item_id);

-- Full-text search: stored tsvector column on sections (content)
ALTER TABLE public.sr_sections ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', COALESCE(content, ''))
  ) STORED;
CREATE INDEX idx_sr_sections_search ON public.sr_sections USING GIN(search_vector);

-- Note on sr_sections.heading vs sr_section_templates.heading:
-- sr_sections.heading is the authoritative heading for rendering. When a section is
-- created from a template, heading is initialized from sr_section_templates.heading.
-- template_id is a soft reference for tracking which template a section was created from.
-- If a template is deleted (ON DELETE SET NULL), the section's heading persists unchanged.
-- If a template's heading is renamed, existing sections are NOT automatically updated —
-- the admin must update them manually if desired. This preserves content stability.

-- ============================================================
-- Updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION sr_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sr_collections_updated_at BEFORE UPDATE ON public.sr_collections
  FOR EACH ROW EXECUTE FUNCTION sr_update_timestamp();
CREATE TRIGGER sr_section_templates_updated_at BEFORE UPDATE ON public.sr_section_templates
  FOR EACH ROW EXECUTE FUNCTION sr_update_timestamp();
CREATE TRIGGER sr_categories_updated_at BEFORE UPDATE ON public.sr_categories
  FOR EACH ROW EXECUTE FUNCTION sr_update_timestamp();
CREATE TRIGGER sr_items_updated_at BEFORE UPDATE ON public.sr_items
  FOR EACH ROW EXECUTE FUNCTION sr_update_timestamp();
CREATE TRIGGER sr_sections_updated_at BEFORE UPDATE ON public.sr_sections
  FOR EACH ROW EXECUTE FUNCTION sr_update_timestamp();
```

### RLS Policies

```sql
-- Enable RLS on all tables
ALTER TABLE public.sr_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sr_section_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sr_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sr_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sr_sections ENABLE ROW LEVEL SECURITY;

-- Admin full access (CRUD)
CREATE POLICY "sr_collections_admin_all" ON public.sr_collections
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "sr_section_templates_admin_all" ON public.sr_section_templates
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "sr_categories_admin_all" ON public.sr_categories
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "sr_items_admin_all" ON public.sr_items
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "sr_sections_admin_all" ON public.sr_sections
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Authenticated portal users: read-only on published content (all collections)
CREATE POLICY "sr_collections_auth_select" ON public.sr_collections
  FOR SELECT TO authenticated
  USING (status = 'published');

CREATE POLICY "sr_section_templates_auth_select" ON public.sr_section_templates
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sr_collections
    WHERE id = sr_section_templates.collection_id AND status = 'published'
  ));

CREATE POLICY "sr_categories_auth_select" ON public.sr_categories
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sr_collections
    WHERE id = sr_categories.collection_id AND status = 'published'
  ));

CREATE POLICY "sr_items_auth_select" ON public.sr_items
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.sr_collections
      WHERE id = sr_items.collection_id AND status = 'published'
    )
  );

CREATE POLICY "sr_sections_auth_select" ON public.sr_sections
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sr_items
    WHERE id = sr_sections.item_id AND status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.sr_collections
      WHERE id = sr_items.collection_id AND status = 'published'
    )
  ));

-- Anon users: full read access to public collections, teaser-only for auth-gated
-- Note: 'inherit' collections resolve to module config at the application layer;
-- at the DB layer, anon can see collection metadata for all published collections
-- (the portal app checks effective access and conditionally renders content vs teaser)
CREATE POLICY "sr_collections_anon_select" ON public.sr_collections
  FOR SELECT TO anon
  USING (status = 'published');

-- Anon users: full content access ONLY for explicitly public collections
CREATE POLICY "sr_categories_anon_select" ON public.sr_categories
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.sr_collections
    WHERE id = sr_categories.collection_id
    AND status = 'published' AND access = 'public'
  ));

CREATE POLICY "sr_items_anon_select" ON public.sr_items
  FOR SELECT TO anon
  USING (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.sr_collections
      WHERE id = sr_items.collection_id
      AND status = 'published' AND access = 'public'
    )
  );

CREATE POLICY "sr_sections_anon_select" ON public.sr_sections
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.sr_items
    WHERE id = sr_sections.item_id AND status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.sr_collections
      WHERE id = sr_items.collection_id
      AND status = 'published' AND access = 'public'
    )
  ));

CREATE POLICY "sr_section_templates_anon_select" ON public.sr_section_templates
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.sr_collections
    WHERE id = sr_section_templates.collection_id
    AND status = 'published' AND access = 'public'
  ));
```

### RPC Functions

```sql
-- Full-text search across items and sections
CREATE OR REPLACE FUNCTION sr_search_items(
  p_collection_id UUID,
  p_query TEXT,
  p_category_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  item_id UUID,
  item_title TEXT,
  item_slug TEXT,
  item_subtitle TEXT,
  category_id UUID,
  category_name TEXT,
  category_slug TEXT,
  relevance REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (i.id)
    i.id AS item_id,
    i.title AS item_title,
    i.slug AS item_slug,
    i.subtitle AS item_subtitle,
    c.id AS category_id,
    c.name AS category_name,
    c.slug AS category_slug,
    ts_rank(
      i.search_vector || COALESCE(s.search_vector, ''::tsvector),
      plainto_tsquery('english', p_query)
    ) AS relevance
  FROM public.sr_items i
  JOIN public.sr_categories c ON c.id = i.category_id
  LEFT JOIN public.sr_sections s ON s.item_id = i.id
  WHERE i.collection_id = p_collection_id
    AND i.status = 'published'
    AND (p_category_id IS NULL OR i.category_id = p_category_id)
    AND (
      i.search_vector @@ plainto_tsquery('english', p_query)
      OR EXISTS (
        SELECT 1 FROM public.sr_sections sec
        WHERE sec.item_id = i.id
        AND sec.search_vector @@ plainto_tsquery('english', p_query)
      )
    )
  ORDER BY i.id, relevance DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
-- Note: SECURITY INVOKER ensures this function respects the caller's RLS policies.
-- Anon callers will only get results from public collections; authenticated callers
-- will get results from all published collections. This is the correct behavior.
```

### Access Resolution Logic

The `inherit` access value on collections requires application-layer resolution before choosing which Supabase client to use. The portal implements this as follows:

1. Fetch all published collections (anon can see collection metadata for all published collections)
2. For each collection, compute effective access:
   - If `collection.access === 'public'` → effective = `'public'`
   - If `collection.access === 'authenticated'` → effective = `'authenticated'`
   - If `collection.access === 'inherit'` → effective = module config `default_access` value
3. Use Supabase client accordingly:
   - Effective `'public'` → anon client works (RLS allows anon reads for `access = 'public'`)
   - Effective `'authenticated'` but `collection.access === 'inherit'` → must use authenticated client, since DB-level anon policies only allow `access = 'public'`
   - This means `inherit` collections are always auth-gated at the DB layer (safe default), and the app layer decides whether to treat them as public based on module config

**Important**: When `default_access = 'public'` and a collection has `access = 'inherit'`, the portal must still use the authenticated client for that collection's items/sections (anon RLS won't match `access = 'inherit'`). The portal shows the content publicly but fetches it via the server-side authenticated client. This preserves the security invariant that the DB never exposes `inherit` content to anonymous users directly.

## Infrastructure Requirements

No additional infrastructure beyond the existing Gatewaze stack:
- PostgreSQL (Supabase) for data storage and RLS
- Supabase Auth for portal authentication
- Next.js 15 for portal SSR
- React 19 + Vite for admin SPA

## Security Considerations

### Authentication
- Portal resolves each collection's effective access: `access = 'public'` or `'authenticated'`; `'inherit'` falls back to module-level `default_access` config
- Public collections: fetched with anon Supabase client, no login required. RLS permits full read.
- Authenticated collections: fetched with authenticated Supabase client (cookie-based session via `createServerClient`). Unauthenticated visitors see teaser or nothing depending on `show_teaser` config. RLS blocks anon access to categories/items/sections for non-public collections.
- Session is verified server-side in Next.js Server Components

### Authorization
- Admin CRUD is protected by `is_admin()` RLS check at the database level. The `is_admin()` function is a core Gatewaze platform function defined in migration `00002_admin.sql` — it checks whether the current `auth.uid()` has an active record in the `admin_profiles` table with an admin role (super_admin, admin, or editor). The admin app uses the authenticated Supabase client (not service_role), so all operations go through RLS.
- Admin routes use `FeatureGuard` with `requiredFeature: 'structured-resources'`
- Portal authorization is per-collection (`access` field), not per-item or per-role
- All authenticated portal users see all published content in collections they can access

### Input Validation
- Rich text content is sanitized both on input (server-side, before storage in the database) and on output (client-side, using DOMPurify before `dangerouslySetInnerHTML`). Double sanitization provides defense in depth — even if one layer is bypassed, the other prevents XSS.
- Slug generation strips special characters and enforces URL-safe format
- External URLs are validated as proper URLs before storage
- SQL injection prevented by Supabase client parameterized queries
- Markdown import parser does not execute arbitrary code. Imported markdown is converted to HTML, and that HTML is sanitized (same server-side sanitization as regular rich text input) before storage.

### Data Protection
- All content stored in PostgreSQL with RLS enforced at every query
- Auth-gated content: not cached in public CDN or edge cache; Server Components fetch per request
- Public content: may be cached normally as no auth check is needed
- The `access` field on `sr_collections` is the source of truth for RLS enforcement — the application layer handles `inherit` resolution but the DB layer defaults to restricting anon access for `inherit` collections (safe default)

## Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| Unauthenticated access to auth-gated collection | Redirect to `/sign-in` with return URL, or show teaser if `show_teaser` enabled |
| Collection/item not found | Next.js `notFound()` → 404 page |
| Collection not published | RLS filters it out — returns empty result → 404 |
| Admin CRUD failure | Toast notification with error message from Supabase |
| Markdown import parse failure | Show parse errors inline with line numbers, allow partial import |
| Search returns no results | Show "No results found" message with suggestion to clear filters |
| Image URL broken | Fallback placeholder image via `onError` handler |

## Performance Requirements / SLAs

- Portal page load (collection listing): < 500ms TTFB
- Portal page load (item detail): < 400ms TTFB
- Admin collection detail page: < 1s initial load with up to 200 items
- Search results: < 300ms for collections with up to 500 items
- Markdown import: parse and persist up to 50,000 words (including database insertion) in < 10s

### Optimization Strategies
- Portal Server Components: data fetched at request time, HTML streamed to client
- Database indexes on all foreign keys, slugs, and status columns
- Full-text search via PostgreSQL `tsvector` — no external search service needed
- Sections loaded eagerly with item (single query with join) to avoid N+1
- Admin pagination for large collections (50 items per page default)

## Observability

- Standard Supabase query logging for all database operations
- Admin CRUD operations logged via existing Gatewaze audit patterns
- Portal auth failures logged server-side for security monitoring
- Module lifecycle events (`onInstall`, `onEnable`, `onDisable`) logged to console

## Testing Strategy

### Unit Tests
- Slug generation and uniqueness logic
- Markdown import parser (category detection, item detection, section splitting)
- Section template validation (required sections present)

### Integration Tests
- RLS policy verification: admin can CRUD, authenticated user can read published, anon can only read teaser
- Search RPC function returns correct results with ranking
- Cascade deletes work correctly (collection → categories → items → sections)

### E2E Tests
- Full admin flow: create collection → add section templates → add categories → add items with sections → publish
- Portal flow: unauthenticated redirect → sign in → browse collections → view item
- Markdown import: upload file → preview → confirm → verify created data

## Deployment Strategy

Standard Gatewaze module deployment:
1. Module is registered in `gatewaze.config.ts` module sources
2. Admin installs module via module management UI
3. `onInstall` hook runs → migration `001_structured_resources.sql` executes
4. Admin enables module → `onEnable` hook runs → portal nav updated
5. No downtime — module is additive, no core schema changes

### Rollback
- Disable module removes portal nav and admin routes
- Database tables persist (no destructive rollback)
- Re-enable restores full functionality

## Migration Plan

### From Markdown Content
The import tool supports the following markdown structure mapping:

```
# Document Title          → Collection name
## Category Heading       → Category
### Item Heading          → Item title
[URL](...)               → Item external_url (first link in item)
#### Section Heading      → Section heading
**Bold Section Heading**  → Section heading (alternative format)
Body text                → Section content
---                      → Section separator
```

### Import Flow
1. Admin navigates to import page
2. Pastes or uploads markdown content
3. Parser extracts structure and displays preview tree
4. Admin selects target collection (new or existing)
5. Parser maps detected section headings to collection's section templates
6. Admin reviews mapping and adjusts if needed
7. Import creates categories, items, and sections in a single transaction
8. Summary shows created counts and any warnings

## Open Questions / Future Considerations

1. **Analytics**: Should we track view counts per item or per section? Could inform content strategy. Deferred to v2.
2. **Bookmarks/favorites**: Should authenticated users be able to bookmark items? Would require a user-item junction table. Deferred to v2.
3. **Content versioning**: Track edit history for audit purposes. Deferred to v2.
4. **Collection-level access control**: Gate specific collections to specific user groups or roles. Deferred to v2.
5. **Export**: Allow exporting a collection back to markdown or PDF. Deferred to v2.
6. **Embedding search**: Vector similarity search for semantic content discovery. Could reuse the blog module's embedding pattern. Deferred to v2.
7. **Cross-linking**: Allow items to reference other items within or across collections. Deferred to v2.
