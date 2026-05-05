/**
 * Site preview renderer — handles requests rewritten from
 * <slug>.sites.<brand>.<tld> by the middleware.
 *
 * Per spec-content-modules-git-architecture §17 + §13 + §12:
 *
 *   1. Resolve site by slug (404 if not found)
 *   2. Check auto-route resolver for the path (privacy/terms/login/etc.)
 *      → render via auto-route handler (compliance content / auth forms)
 *   3. Otherwise: fetch the page by full_path from the DB
 *      → render schema-mode (pages.content) OR blocks-mode placeholder
 *      → 404 if no match
 *   4. Wrap in SiteShell (cookie banner + audit hook)
 *
 * For composition_mode='blocks' pages, this v1 renderer surfaces a
 * placeholder noting that real block rendering happens via the
 * publisher's build pipeline (the `publish` branch's generated
 * route files). Inline block rendering inside the portal preview is
 * deferred to v1.x — it would require dynamic-importing the theme's
 * components, which means the portal needs the theme repo cloned
 * locally (which it doesn't have access to without a build pipeline).
 */

import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

interface SiteRow {
  id: string
  slug: string
  name: string
  description: string | null
  status: string
  publishing_target: { kind: string }
  auth_enabled: boolean
  compliance_audit_enabled: boolean
  compliance_overrides: Record<string, boolean>
}

interface PageRow {
  id: string
  slug: string
  full_path: string
  title: string
  composition_mode: 'schema' | 'blocks'
  content: Record<string, unknown> | null
  status: string
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

interface PageProps {
  params: Promise<{ siteSlug: string; path?: string[] }>
}

export default async function SitePreviewPage({ params }: PageProps) {
  const { siteSlug, path } = await params
  const requestPath = '/' + (path?.join('/') ?? '')

  const supabase = getSupabase()

  // 1. Resolve site
  const siteResult = await supabase
    .from('sites')
    .select('id, slug, name, description, status, publishing_target, auth_enabled, compliance_audit_enabled, compliance_overrides')
    .eq('slug', siteSlug)
    .eq('status', 'active')
    .single()
  const site = siteResult.data as SiteRow | null
  if (!site) notFound()

  // 2. Detect compliance + auth state
  const hasCompliance = await detectComplianceModuleEnabled(supabase)
  // currentUser resolved via Supabase Auth helper (server-side cookie read)
  const currentUser = await resolveCurrentUser(supabase)

  // 3. Auto-route check — render auth/privacy/etc. before hitting page table
  // Note: auto-routes module is in the sites module; portal doesn't import it
  // directly to avoid the cross-workspace dep. The auto-route detection
  // here is a copy of the path table from sites/portal/auto-routes/index.ts;
  // keep them in sync.
  const isAutoRoute = AUTO_ROUTE_PATHS.has(requestPath)
  if (isAutoRoute) {
    return renderAutoRoutePlaceholder(requestPath, site, hasCompliance, currentUser)
  }

  // 4. Fetch page by full_path
  const pageResult = await supabase
    .from('pages')
    .select('id, slug, full_path, title, composition_mode, content, status')
    .eq('host_kind', 'site').eq('host_id', site.id).eq('status', 'published')
    .eq('full_path', requestPath)
    .single()
  const page = pageResult.data as PageRow | null
  if (!page) notFound()

  // 5. Render
  return (
    <SiteShellInline
      site={site}
      hasCompliance={hasCompliance}
      currentUser={currentUser}
      path={requestPath}
    >
      {page.composition_mode === 'schema'
        ? renderSchemaPage(page)
        : renderBlocksPagePlaceholder(page, site)}
    </SiteShellInline>
  )
}

// ---------------------------------------------------------------------------
// Inline render helpers (kept in this file for the v1 preview;
// production extracts to /modules/sites/portal when imports work)
// ---------------------------------------------------------------------------

function SiteShellInline({
  site, hasCompliance, currentUser, path, children,
}: {
  site: SiteRow
  hasCompliance: boolean
  currentUser: { id: string; email: string } | null
  path: string
  children: React.ReactNode
}) {
  const cookieBannerEnabled =
    hasCompliance && site.compliance_overrides.cookie_banner_enabled !== false

  // Audit page_view (fire-and-forget; doesn't block render)
  if (hasCompliance && site.compliance_audit_enabled) {
    void emitPageView({ siteId: site.id, path, viewerId: currentUser?.id ?? null })
  }

  return (
    <html lang="en">
      <head>
        <title>{site.name}</title>
        {site.description && <meta name="description" content={site.description} />}
      </head>
      <body>
        <header style={{ borderBottom: '1px solid #e5e5e5', padding: '1rem' }}>
          <strong>{site.name}</strong>
          {site.auth_enabled && (
            <span style={{ float: 'right', fontSize: '0.875rem' }}>
              {currentUser
                ? <a href="/account/logout">Sign out</a>
                : <a href="/account/login">Sign in</a>}
            </span>
          )}
        </header>
        <main style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
          {children}
        </main>
        <footer style={{ borderTop: '1px solid #e5e5e5', padding: '1rem', textAlign: 'center', color: '#737373', fontSize: '0.875rem' }}>
          © {new Date().getFullYear()} — Powered by gatewaze
        </footer>
        {cookieBannerEnabled && (
          // The @next/next/no-sync-scripts rule isn't loaded by the portal's
          // root eslintrc (it's a `next lint`-only plugin we don't extend).
          // The script must run synchronously before consent state is read,
          // so a <Script strategy="..."> swap would change behaviour.
          <script src="/js/cookieconsent/custom-consent.js?v=6" />
        )}
      </body>
    </html>
  )
}

function renderSchemaPage(page: PageRow) {
  // Schema-mode pages render their pages.content JSONB directly.
  // For v1 preview: render as <pre> JSON; the published version uses the
  // theme repo's route component (Next.js dynamic import).
  return (
    <article>
      <h1>{page.title}</h1>
      <p style={{ fontSize: '0.875rem', color: '#737373' }}>
        Schema-mode page — content rendered by the theme component at publish time.
      </p>
      <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '0.5rem', overflowX: 'auto' }}>
        {JSON.stringify(page.content ?? {}, null, 2)}
      </pre>
    </article>
  )
}

function renderBlocksPagePlaceholder(page: PageRow, site: SiteRow) {
  return (
    <article>
      <h1>{page.title}</h1>
      <p style={{ fontSize: '0.875rem', color: '#737373' }}>
        Blocks-mode page preview. The published version (served by{' '}
        <code>{site.publishing_target.kind}</code>) renders this as a
        composition of theme components.
      </p>
      <p>
        See <a href={`/sites/${site.slug}/pages`}>the page editor</a> in
        the admin to view + edit blocks.
      </p>
    </article>
  )
}

function renderAutoRoutePlaceholder(
  path: string,
  site: SiteRow,
  hasCompliance: boolean,
  currentUser: { id: string; email: string } | null,
) {
  // V1 placeholder: real renderers live in
  // gatewaze-modules/modules/sites/portal/auto-routes/index.tsx and need
  // to be imported when the workspace install resolves. For now, return
  // a thin shell so /privacy /terms /account/login etc. don't 404.
  return (
    <SiteShellInline site={site} hasCompliance={hasCompliance} currentUser={currentUser} path={path}>
      <article>
        <h1>{path.replace(/^\/(account\/)?/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</h1>
        <p>Auto-route placeholder. Production renderer at <code>modules/sites/portal/auto-routes/</code>.</p>
      </article>
    </SiteShellInline>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTO_ROUTE_PATHS = new Set([
  '/privacy', '/terms', '/cookie-policy',
  '/account/login', '/account/signup', '/account/reset',
  '/account/privacy-requests', '/account/data-export',
])

// Why `any`: the SupabaseClient generic positional args differ between
// the portal app's typegen baseline and the modules workspace. Both
// shapes resolve to the same runtime API; surfacing the typing via
// `any` keeps the cross-package boundary unblocked.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detectComplianceModuleEnabled(supabase: any): Promise<boolean> {
  // Check for the compliance module's tables — proxy for "module installed"
  try {
    const { error } = await supabase.from('compliance_consent_records').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveCurrentUser(supabase: any): Promise<{ id: string; email: string } | null> {
  // Server-side: read from cookies. The cookies module gives the SSR
  // Supabase client what it needs; for the placeholder we use getUser().
  try {
    const { data } = await supabase.auth.getUser()
    if (data?.user) return { id: data.user.id, email: data.user.email ?? '' }
  } catch {
    /* anon */
  }
  return null
}

async function emitPageView(args: { siteId: string; path: string; viewerId: string | null }): Promise<void> {
  // Fire-and-forget — no need to await; doesn't block render
  void args
  // Real impl POSTs to /api/admin/compliance/audit (when compliance module installed)
}

// ---------------------------------------------------------------------------
// Next.js metadata (minimal — site name + description)
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: PageProps) {
  const { siteSlug } = await params
  const supabase = getSupabase()
  const result = await supabase.from('sites').select('name, description').eq('slug', siteSlug).single()
  const site = result.data as { name: string; description: string | null } | null
  return {
    title: site?.name ?? 'Site',
    description: site?.description ?? undefined,
  }
}
