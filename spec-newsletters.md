# Technical Specification: Newsletters Module Refactor

## Overview / Context

The Gatewaze platform has an existing newsletters module in `premium-gatewaze-modules` that provides a block-based newsletter editor with drag-and-drop composition, HTML generation, and link tracking. The current implementation has several architectural limitations:

1. **Tightly coupled outputs** — Customer.io, Substack, and Beehiiv output formats are hardcoded in `htmlGenerator.ts` as an `OutputFormat` union type. Adding a new platform requires modifying core generation code.
2. **Hardcoded link shortener** — Short.io is the only supported URL redirect/shortening provider, embedded directly in `linkService.ts`.
3. **No template management UI** — Block and brick HTML templates are stored in the database (`newsletters_block_templates`, `newsletters_brick_templates`) but there is no admin UI to create, edit, or manage them.
4. **Single template set** — There's no concept of multiple newsletter "template sets" (e.g., a community newsletter vs. a members newsletter), each with different visual designs and block configurations.

This spec defines the architecture for refactoring the newsletters module into a modular, extensible system.

## Goals

1. **Modular outputs**: Extract each output format (HTML/Email, Substack, Beehiiv) into separate, independently installable modules that implement a common output adapter interface.
2. **Modular link shorteners**: Extract Short.io into a redirect adapter module, enabling alternatives like Bitly, Rebrandly, or custom solutions.
3. **Template management UI**: Provide a full admin interface for creating, editing, previewing, and managing block and brick HTML templates.
4. **HTML template upload & auto-parse**: Allow designers to upload a single HTML file with comment-delimited blocks/bricks, which the system parses into individual templates. Supports round-trip export back to HTML.
5. **Multi-template support**: Allow multiple named "template collections" so different newsletters (community, members, etc.) can have distinct visual designs and block/brick configurations.
6. **Per-output template variants**: Each template collection can define output-specific HTML variants (e.g., a block's HTML for email vs. Substack vs. Beehiiv).
7. **Newsletter sending**: When the `bulk-emailing` module is enabled, allow sending newsletter editions to subscription lists with immediate or scheduled delivery via SendGrid.
8. **Portal subscription center**: A portal page where users can manage their email topic preferences at a granular level, plus public unsubscribe endpoints for email links and external APIs.

## Non-Goals

- Building a full WYSIWYG HTML template editor (code-based editing with live preview is sufficient).
- Migrating away from Mustache-style template syntax.
- Changing the existing block/brick content schema or drag-and-drop editor UX.
- Building new output platform integrations beyond the existing three (HTML email, Substack, Beehiiv) — though the architecture must support them.
- Real-time collaborative editing of newsletters.

---

## System Architecture

### Current Architecture

```
newsletters (module)
├── EditionCanvas → htmlGenerator.ts (hardcoded OutputFormat switch)
├── linkGenerator.ts → linkService.ts (hardcoded Short.io API)
├── Block/Brick templates (in DB, no management UI)
└── Single implicit template set
```

### Proposed Architecture

```
newsletters (core module)
├── Output Adapter Interface (INewsletterOutputAdapter)
│   ├── newsletters-output-html (default module) — renamed from "Customer.io"
│   ├── newsletters-output-substack (optional module)
│   ├── newsletters-output-beehiiv (optional module)
│   └── newsletters-output-{future} (optional modules)
│
├── Redirect Adapter Interface (IRedirectAdapter)
│   ├── redirects-shortio (existing, refactored as adapter)
│   ├── redirects-bitly (optional module)
│   └── redirects-{future} (optional modules)
│
├── Template Management
│   ├── Template Collections (named sets of block/brick templates)
│   ├── Per-output template variants within each collection
│   └── Admin UI for CRUD operations on templates
│
└── Edition Editor (existing, enhanced)
    ├── Template collection selector per edition
    ├── Output preview tabs (dynamically populated from installed output modules)
    └── Link generation using configured redirect adapter
```

---

## Component Design

### 1. Output Adapter System

#### Interface Definition

```typescript
// types/output-adapter.ts (in newsletters core module)

export interface OutputAdapterMeta {
  /** Unique adapter ID, e.g. 'html', 'substack', 'beehiiv' */
  id: string;
  /** Display name for UI tabs/dropdowns */
  label: string;
  /** Short description */
  description: string;
  /** Icon name for UI */
  icon: string;
  /** Sort order for UI display */
  order: number;
}

export interface OutputRenderContext {
  edition: NewsletterEdition;
  blocks: NewsletterEditionBlock[];
  bricks: Map<string, NewsletterEditionBrick[]>;
  templateCollection: TemplateCollection;
  links: Map<string, string>; // original URL → short URL
  metadata: Record<string, unknown>;
}

export interface INewsletterOutputAdapter {
  meta: OutputAdapterMeta;

  /**
   * Render the full newsletter output for this platform.
   * Returns the complete output string (HTML, rich text, markdown, etc.)
   */
  render(context: OutputRenderContext, options?: OutputRenderOptions): Promise<string>;

  /**
   * Which block types this adapter excludes (e.g., Substack excludes 'header', 'footer').
   * Core editor uses this to show/hide blocks in preview.
   */
  excludedBlockTypes: string[];

  /**
   * Whether this adapter uses the 'html_template' or 'rich_text_template'
   * field from block/brick templates, or a custom variant key.
   */
  templateVariantKey: string;

  /**
   * Optional: transform links for this platform.
   * E.g., Substack may not need short links, or may need different UTM params.
   */
  transformLink?(originalUrl: string, shortUrl: string, channel: string): string;

  /**
   * Optional: post-process the final output (e.g., inline CSS for email).
   */
  postProcess?(html: string): Promise<string>;

  /**
   * Whether this adapter supports embedding block/brick comment delimiters
   * in the output (for round-trip editing by designers outside the admin UI).
   * If true, the render method accepts an `includeBlockComments` option.
   */
  supportsBlockComments?: boolean;
}

export interface OutputRenderOptions {
  /**
   * When true, the rendered output includes <!-- BLOCK:type --> / <!-- /BLOCK:type -->
   * comment delimiters around each block (and similarly for bricks).
   * This allows the HTML to be exported, edited externally, and re-imported.
   * Only applicable for adapters where supportsBlockComments is true.
   * Default: false.
   */
  includeBlockComments?: boolean;
}
```

#### Module Registration

Each output adapter module registers itself with the newsletters core via the existing Gatewaze module system:

```typescript
// modules/newsletters-output-html/index.ts
const htmlOutputModule: GatewazeModule = {
  id: 'newsletters-output-html',
  type: 'integration',
  visibility: 'public',
  version: '1.0.0',
  features: ['newsletters.output.html'],
  dependencies: ['newsletters'],
  provides: {
    'newsletters:output-adapter': HtmlOutputAdapter,
  },
};
```

The core newsletters module discovers installed output adapters at runtime via the module registry:

```typescript
// In newsletters core
function getInstalledOutputAdapters(): INewsletterOutputAdapter[] {
  return moduleRegistry
    .getModulesProviding('newsletters:output-adapter')
    .map(m => m.provides['newsletters:output-adapter'])
    .sort((a, b) => a.meta.order - b.meta.order);
}
```

#### Default Output Adapters

| Module ID | Adapter ID | Template Variant Key | Description |
|-----------|-----------|---------------------|-------------|
| `newsletters-output-html` | `html` | `html_template` | Full HTML email output (table-based, inlined CSS, Outlook compat). Default/always-installed. Supports optional `includeBlockComments` for round-trip designer editing. |
| `newsletters-output-substack` | `substack` | `rich_text_template` | Semantic HTML for Substack rich text editor paste. |
| `newsletters-output-beehiiv` | `beehiiv` | `rich_text_template` | Semantic HTML for Beehiiv rich text editor paste. |

### 2. Redirect Adapter System

#### Interface Definition

```typescript
// types/redirect-adapter.ts (in newsletters core or redirects core)

export interface RedirectAdapterMeta {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export interface RedirectLink {
  originalUrl: string;
  shortPath: string;
  domain?: string;
}

export interface RedirectResult {
  originalUrl: string;
  shortUrl: string;
  shortPath: string;
  providerId: string; // e.g., Short.io link ID
  status: 'created' | 'error';
  error?: string;
}

export interface IRedirectAdapter {
  meta: RedirectAdapterMeta;

  /**
   * Create multiple short links in bulk.
   */
  createBulk(links: RedirectLink[]): Promise<RedirectResult[]>;

  /**
   * Delete a previously created short link.
   */
  delete(providerId: string): Promise<void>;

  /**
   * Get analytics/stats for a short link.
   */
  getStats?(providerId: string): Promise<{ clicks: number; [key: string]: unknown }>;

  /**
   * Validate adapter configuration (API key set, domain configured, etc.)
   */
  validateConfig(): Promise<{ valid: boolean; error?: string }>;
}
```

#### Module Registration (same pattern as output adapters)

```typescript
// modules/redirects-shortio/index.ts
const shortioModule: GatewazeModule = {
  id: 'redirects-shortio',
  type: 'integration',
  visibility: 'public',
  version: '1.0.0',
  features: ['redirects.shortio'],
  dependencies: ['redirects'],
  provides: {
    'redirects:adapter': ShortIoAdapter,
  },
  configSchema: {
    apiKey: { type: 'string', required: true, secret: true },
    domain: { type: 'string', required: true },
  },
};
```

The newsletters module uses whichever redirect adapter is installed:

```typescript
function getActiveRedirectAdapter(): IRedirectAdapter | null {
  const adapters = moduleRegistry.getModulesProviding('redirects:adapter');
  return adapters.length > 0 ? adapters[0].provides['redirects:adapter'] : null;
}
```

### 3. Template Collection System

#### Data Model

**New table: `newsletters_template_collections`**

```sql
CREATE TABLE newsletters_template_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- e.g., "Community Newsletter", "Members Newsletter"
  slug TEXT NOT NULL UNIQUE,             -- e.g., "community", "members"
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,     -- One collection is the default
  metadata JSONB DEFAULT '{}',          -- Extensible config (colors, fonts, etc.)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure only one default
CREATE UNIQUE INDEX idx_template_collections_default
  ON newsletters_template_collections (is_default) WHERE is_default = TRUE;
```

**Modified table: `newsletters_block_templates`** (add collection + variant support)

```sql
ALTER TABLE newsletters_block_templates
  ADD COLUMN collection_id UUID REFERENCES newsletters_template_collections(id) ON DELETE CASCADE,
  ADD COLUMN variant_key TEXT NOT NULL DEFAULT 'html_template';
  -- variant_key: 'html_template', 'rich_text_template', or custom adapter keys

-- A block template is unique per (collection, block_type, variant_key)
CREATE UNIQUE INDEX idx_block_templates_unique
  ON newsletters_block_templates (collection_id, block_type, variant_key);
```

**Modified table: `newsletters_brick_templates`** (same pattern)

```sql
ALTER TABLE newsletters_brick_templates
  ADD COLUMN collection_id UUID REFERENCES newsletters_template_collections(id) ON DELETE CASCADE,
  ADD COLUMN variant_key TEXT NOT NULL DEFAULT 'html_template';

CREATE UNIQUE INDEX idx_brick_templates_unique
  ON newsletters_brick_templates (collection_id, brick_type, variant_key);
```

**Modified table: `newsletters_editions`** (link to collection)

```sql
ALTER TABLE newsletters_editions
  ADD COLUMN collection_id UUID REFERENCES newsletters_template_collections(id);
```

#### Template Variant Resolution

When rendering a newsletter for a specific output adapter:

1. Look up the edition's `collection_id`
2. For each block, find the block template matching `(collection_id, block_type, variant_key)` where `variant_key` = the output adapter's `templateVariantKey`
3. If no variant-specific template exists, fall back to the `html_template` variant
4. Same logic for bricks

```typescript
async function resolveTemplate(
  collectionId: string,
  blockType: string,
  variantKey: string
): Promise<BlockTemplate | null> {
  // Try exact variant match first
  let template = await db.from('newsletters_block_templates')
    .select('*')
    .eq('collection_id', collectionId)
    .eq('block_type', blockType)
    .eq('variant_key', variantKey)
    .single();

  // Fallback to html_template variant
  if (!template && variantKey !== 'html_template') {
    template = await db.from('newsletters_block_templates')
      .select('*')
      .eq('collection_id', collectionId)
      .eq('block_type', blockType)
      .eq('variant_key', 'html_template')
      .single();
  }

  return template;
}
```

### 4. HTML Template Upload & Auto-Parse

#### Concept

Designers should be able to work in a single HTML file using their preferred tools (Figma export, VS Code, Dreamweaver, etc.) without needing to interact with the admin UI at all. The designer creates a complete newsletter template as one HTML file, using standardized HTML comments to mark block and brick boundaries. This file is then uploaded to the admin UI, which parses it into individual block and brick templates automatically.

This provides two workflows:
1. **Designer workflow**: Design full template in HTML → upload → blocks auto-extracted
2. **Admin workflow**: Edit individual blocks via Monaco editor in the admin UI (existing approach)

Both workflows produce the same data in `newsletters_block_templates` / `newsletters_brick_templates`.

#### Comment Convention

Blocks and bricks are delimited by paired HTML comments:

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    /* Global styles shared across all blocks */
    body { font-family: Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; }
  </style>
</head>
<body>
  <!-- BLOCK:header -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding: 20px;">
        <img src="{{logo_url}}" alt="Logo" />
        <h1>{{header_title}}</h1>
        <p>Edition: {{edition_date}}</p>
      </td>
    </tr>
  </table>
  <!-- /BLOCK:header -->

  <!-- BLOCK:intro_paragraph -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding: 20px;">
        <p>{{intro_text}}</p>
        <a href="{{cta_link}}">{{cta_text}}</a>
      </td>
    </tr>
  </table>
  <!-- /BLOCK:intro_paragraph -->

  <!-- BLOCK:mlops_community | has_bricks=true -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding: 20px;">
        <h2>{{section_title}}</h2>

        <!-- BRICK:podcast -->
        <div class="brick">
          <h3>{{title}}</h3>
          <p>{{description}}</p>
          <a href="{{spotify_link}}">Spotify</a>
          <a href="{{apple_link}}">Apple</a>
        </div>
        <!-- /BRICK:podcast -->

        <!-- BRICK:blog_post -->
        <div class="brick">
          <h3>{{title}}</h3>
          <p>{{description}}</p>
          <a href="{{blog_link}}">{{link_text}}</a>
        </div>
        <!-- /BRICK:blog_post -->

      </td>
    </tr>
  </table>
  <!-- /BLOCK:mlops_community -->

  <!-- BLOCK:footer -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td>{{footer_content}}</td></tr>
  </table>
  <!-- /BLOCK:footer -->
</body>
</html>
```

#### Comment Syntax

```
<!-- BLOCK:<block_type> [| key=value, key=value] -->
  ...block HTML with {{mustache}} variables...
  <!-- BRICK:<brick_type> [| key=value] -->
    ...brick HTML...
  <!-- /BRICK:<brick_type> -->
<!-- /BLOCK:<block_type> -->
```

**Supported metadata attributes** (optional, after `|`):
- `has_bricks=true` — Marks that this block contains brick sub-components
- `name=My Block Name` — Human-readable display name (defaults to title-cased block_type)
- `description=Some description` — Block description for the palette
- `order=5` — Sort order in the block palette

#### Parser Logic

```typescript
interface ParsedTemplate {
  globalStyles: string;           // <style> content from <head>
  blocks: ParsedBlock[];
  warnings: string[];             // Non-fatal parse issues
}

interface ParsedBlock {
  blockType: string;              // From comment tag
  name: string;                   // From metadata or auto-generated
  html: string;                   // Raw HTML between comments
  hasBricks: boolean;
  bricks: ParsedBrick[];
  schema: FieldSchema[];          // Auto-inferred from {{variables}}
  metadata: Record<string, string>;
}

interface ParsedBrick {
  brickType: string;
  name: string;
  html: string;
  schema: FieldSchema[];          // Auto-inferred from {{variables}}
  metadata: Record<string, string>;
}
```

**Schema auto-inference from Mustache variables:**

The parser scans each block/brick's HTML for `{{variable_name}}` patterns and infers field schemas:

| Variable pattern | Inferred type | Example |
|-----------------|---------------|---------|
| `*_url`, `*_link`, `href="{{...}}"` | `url` | `{{cta_link}}` → url field |
| `*_image`, `*_img`, `*_logo`, `*_photo`, `src="{{...}}"` | `image` | `{{logo_url}}` → image field |
| `{{#section}}...{{/section}}` | `boolean` (section toggle) | `{{#show_cta}}` → boolean |
| Everything else | `text` | `{{header_title}}` → text field |

Admins can refine inferred schemas after upload (e.g., change a `text` field to `richtext`).

#### Upload Flow

1. **Upload page**: Drag-and-drop or file picker for `.html` file
2. **Parse & preview**: System parses the file and displays:
   - List of detected blocks with their types
   - List of detected bricks within each block
   - Auto-inferred field schemas for each
   - Any warnings (unclosed comments, unknown variables, etc.)
   - Visual preview of each extracted block
3. **Review & adjust**: Admin can:
   - Rename block/brick types
   - Edit inferred field schemas (change types, add labels)
   - Exclude specific blocks from import
   - Choose target template collection (or create new one)
   - Choose which output variant this upload represents (e.g., `html_template` or `rich_text_template`)
4. **Import**: Creates/updates block and brick templates in the selected collection
   - If a block_type already exists in the collection+variant, prompt to overwrite or skip
   - Global `<style>` content is stored in the collection's `metadata.globalStyles`

#### Re-export / Round-trip

The system should also support **exporting** a template collection back to a single HTML file:

```typescript
async function exportCollectionAsHtml(
  collectionId: string,
  variantKey: string
): Promise<string> {
  // Fetches all blocks/bricks, reassembles with comment delimiters
  // Wraps in full HTML document with global styles from collection metadata
}
```

This enables a round-trip workflow:
1. Designer uploads HTML → blocks extracted → admin edits individual blocks → export back to HTML → designer refines → re-upload

### 5. Template Management Admin UI (Individual Editing)

#### New Admin Pages

**Route: `/newsletters/templates`** — Template Collections list

- List all template collections with name, description, block count, default badge
- Create new collection (name, slug, description)
- Duplicate an existing collection (deep copy all block/brick templates)
- Set default collection
- Delete collection (with confirmation, cascade deletes templates)

**Route: `/newsletters/templates/:collectionSlug`** — Collection detail

- Tabs for each installed output adapter variant (e.g., "HTML Email", "Substack", "Beehiiv")
- Within each tab:
  - List of block templates for this (collection, variant)
  - List of brick templates for this (collection, variant)
  - Add new block/brick template
  - Edit existing templates
  - Reorder templates (affects palette order)
  - Toggle `is_active` to enable/disable individual templates

**Route: `/newsletters/templates/:collectionSlug/blocks/:blockType`** — Block template editor

- Split view: code editor (left) + live preview (right)
- **Code editor**: Monaco editor with HTML + Mustache syntax highlighting
- **Schema editor**: JSON editor for the block's field schema (defines what fields appear in the block editor)
- **Preview**: Renders template with sample data, updates on keystroke
- **Metadata**: Name, description, `has_bricks` toggle, `is_active` toggle
- **Variant tabs**: Switch between output variants for this block type within the same collection
- **Copy variant**: Copy HTML from one variant to use as starting point for another

**Same pattern for brick template editor.**

#### Template Editor Component

```typescript
interface TemplateEditorProps {
  collectionId: string;
  templateType: 'block' | 'brick';
  blockType: string; // or brickType
  variantKey: string;
  onSave: (template: BlockTemplate | BrickTemplate) => void;
}
```

Features:
- Monaco editor for HTML/Mustache code
- JSON schema editor for field definitions
- Live preview with mock data auto-generated from schema
- Diff view to compare variants across output adapters
- Import/export templates as JSON

### 6. Edition Editor Enhancements

#### Collection Selector

Add a collection dropdown to the edition creation/edit form:
- When creating a new edition, select which template collection to use
- The block palette shows only blocks from the selected collection
- Changing collection on an existing edition warns about potential template mismatches

#### Dynamic Output Preview Tabs

Replace the hardcoded Customer.io/Substack/Beehiiv tabs with dynamically generated tabs:

```typescript
// In EditionCanvas.tsx
const outputAdapters = useInstalledOutputAdapters();

// Renders tabs based on installed adapter modules
{outputAdapters.map(adapter => (
  <Tab key={adapter.meta.id} label={adapter.meta.label}>
    <HtmlPreview
      edition={edition}
      blocks={blocks}
      adapter={adapter}
      collection={selectedCollection}
    />
  </Tab>
))}
```

#### Link Generation with Adapter

Replace direct Short.io calls with redirect adapter:

```typescript
// In linkService.ts (refactored)
const adapter = getActiveRedirectAdapter();
if (!adapter) {
  throw new Error('No redirect adapter configured. Install a redirect module (e.g., redirects-shortio).');
}

const results = await adapter.createBulk(linksToCreate);
```

### 7. Newsletter Sending & Subscription Management

This section is conditionally enabled when the `bulk-emailing` module is installed. Without it, the newsletters module only supports content creation/editing and manual copy-paste to external platforms.

#### Dependency Chain

```
newsletters (core) ─── creates editions, renders output
    │
    ├── bulk-emailing (required for sending)
    │   ├── email_subscriptions table
    │   ├── email_topic_labels table
    │   ├── email-batch-send edge function (SendGrid)
    │   └── email_logs / email_events tracking
    │
    ├── newsletters-output-html (required for email send content)
    │
    └── redirects-shortio (optional, for link tracking)
```

#### 7.1 Subscription List Management

The existing `email_subscriptions` and `email_topic_labels` tables (from bulk-emailing module) are the foundation. Newsletter-specific lists are created as topic labels with a `newsletter` category.

**Extended topic label schema:**

```sql
ALTER TABLE email_topic_labels
  ADD COLUMN category TEXT DEFAULT 'general',  -- 'general', 'newsletter', 'transactional'
  ADD COLUMN default_subscribed BOOLEAN DEFAULT true;
  -- default_subscribed already exists in gatewaze-admin migration
```

When creating a newsletter edition, the admin selects which subscription list(s) to target. The newsletters module queries topic labels where `category = 'newsletter'` to populate the list selector.

**Admin UI additions:**
- In the Topic Labels tab (existing), add `category` field so admins can categorize lists
- In the newsletter edition editor, add a "Send to" selector showing newsletter-category lists with subscriber counts (via existing `email_get_topic_counts()` RPC)

#### 7.2 Portal Subscription Center

A new portal page where authenticated users can manage their email topic preferences at a granular level.

**Route: `/subscriptions`** (or `/profile/subscriptions`)

**Features:**
- Lists all active topic labels with descriptions
- Toggle switch per topic (subscribed / unsubscribed)
- Groups topics by category (newsletters, general communications, etc.)
- Shows current subscription status pulled from `email_subscriptions` table
- Changes call the existing `people-track-subscription` edge function
- Respects `default_subscribed` — new users see defaults pre-checked
- Link to this page included in every newsletter email footer

```typescript
// Portal component
function SubscriptionCenter() {
  const { user } = useAuth();
  const topics = useTopicLabels({ isActive: true });
  const subscriptions = useUserSubscriptions(user.email);

  // For each topic, show toggle based on:
  // 1. Explicit subscription record if exists
  // 2. Otherwise fall back to topic's default_subscribed
  return (
    <div>
      {Object.entries(groupByCategory(topics)).map(([category, topics]) => (
        <section key={category}>
          <h2>{categoryLabel(category)}</h2>
          {topics.map(topic => (
            <SubscriptionToggle
              key={topic.topic_id}
              topic={topic}
              subscribed={getSubscriptionState(topic, subscriptions)}
              onToggle={(subscribed) => trackSubscription({
                email: user.email,
                list_id: topic.topic_id,
                subscribed,
                source: 'subscription_center'
              })}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
```

#### 7.3 Public Unsubscribe Endpoints

Two mechanisms for unsubscribing without authentication:

**1. One-click unsubscribe link (in email footer)**

Every sent newsletter includes an encoded unsubscribe URL:

```
https://{portal_domain}/unsubscribe?token={encoded_token}
```

The token encodes `{email, list_id, edition_id}` using the existing XOR cipher pattern from `email-batch-send` (or a more secure HMAC-based token).

**Route: `/unsubscribe`** (public, no auth required)
- Decodes token
- Calls `people-track-subscription` with `subscribed: false, source: 'email_unsubscribe'`
- Shows confirmation page: "You've been unsubscribed from {topic_label}"
- Offers link to subscription center for granular management (if user has account)
- Supports RFC 8058 `List-Unsubscribe-Post` header for one-click mailbox unsubscribe

**2. API endpoint for external systems**

```
POST /api/subscriptions/unsubscribe
{
  "email": "user@example.com",
  "list_id": "community_newsletter",
  "source": "external_api"
}
```

- Authenticated via `GW_API_BEARER` token (existing pattern)
- Used by external systems (CRM, support tools) to manage subscriptions
- Also supports `POST /api/subscriptions/subscribe` for the reverse

#### 7.4 Newsletter Send Flow

**Send UI in Edition Editor:**

When `bulk-emailing` module is enabled, the edition editor gains a "Send" section:

```typescript
interface NewsletterSendConfig {
  edition_id: string;
  list_ids: string[];                    // Target subscription lists
  adapter_id: string;                    // Output adapter to use for rendering
  schedule: {
    type: 'immediate' | 'scheduled';
    scheduled_at?: string;               // ISO 8601 datetime (UTC)
  };
  subject: string;                       // Email subject line
  preheader?: string;                    // Preview text
  from_address: string;                  // From preset (existing emailService pattern)
  test_recipients?: string[];            // Optional: send test first
}
```

**Send workflow:**

1. Admin finishes editing edition, clicks "Send Newsletter"
2. Modal shows:
   - Subject line input (pre-filled from edition title)
   - Preheader text input (from edition metadata)
   - Subscription list selector (multi-select, shows subscriber counts)
   - From address selector (existing presets)
   - Schedule picker: "Send now" or date/time picker
   - Preview of rendered HTML via the selected output adapter
3. Admin can "Send Test" to specific email addresses first
4. On confirm, creates a `newsletter_sends` record and triggers the send

**New table: `newsletter_sends`**

```sql
CREATE TABLE newsletter_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES newsletters_editions(id),
  status TEXT NOT NULL DEFAULT 'draft',  -- draft, scheduled, sending, sent, cancelled, failed
  subject TEXT NOT NULL,
  preheader TEXT,
  from_address TEXT NOT NULL,
  from_name TEXT,
  adapter_id TEXT NOT NULL,              -- Which output adapter was used
  collection_id UUID REFERENCES newsletters_template_collections(id),
  list_ids TEXT[] NOT NULL,              -- Target subscription lists
  schedule_type TEXT NOT NULL,           -- 'immediate' or 'scheduled'
  scheduled_at TIMESTAMPTZ,             -- When to send (null = immediate)
  started_at TIMESTAMPTZ,               -- When sending actually began
  completed_at TIMESTAMPTZ,             -- When sending finished
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  rendered_html TEXT,                    -- Cached rendered output
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_newsletter_sends_status ON newsletter_sends(status);
CREATE INDEX idx_newsletter_sends_scheduled ON newsletter_sends(scheduled_at)
  WHERE status = 'scheduled';
```

#### 7.5 Send Execution

**Edge Function: `newsletter-send`**

Orchestrates the actual email delivery:

```
1. Triggered by:
   - Direct invocation (immediate send)
   - Cron/scheduler (for scheduled sends — polls newsletter_sends WHERE status='scheduled' AND scheduled_at <= now())

2. Process:
   a. Load newsletter_sends record
   b. Set status = 'sending', started_at = now()
   c. Render edition HTML using specified output adapter + collection
   d. Cache rendered_html in the send record
   e. Query active subscribers from email_subscriptions WHERE list_id IN (list_ids) AND subscribed = true
   f. Exclude users with do_not_sell = true (CCPA compliance)
   g. Batch recipients (50 per batch, matching existing email-batch-send pattern)
   h. For each batch:
      - Replace per-recipient variables ({{user.first_name}}, unsubscribe link, etc.)
      - Call SendGrid API via email-send function
      - Log each send in email_logs
      - Update sent_count on newsletter_sends
   i. On completion: status = 'sent', completed_at = now()
   j. On failure: status = 'failed', store error in metadata
```

**Scheduling approach:**

For scheduled sends, use a Supabase `pg_cron` job that runs every minute:

```sql
-- Runs every minute, checks for due scheduled sends
SELECT cron.schedule(
  'process-scheduled-newsletters',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/newsletter-send-scheduler',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'
    )
    WHERE EXISTS (
      SELECT 1 FROM newsletter_sends
      WHERE status = 'scheduled' AND scheduled_at <= now()
    );
  $$
);
```

The `newsletter-send-scheduler` edge function picks up due sends and invokes `newsletter-send` for each.

#### 7.6 Per-Recipient Variable Injection

The rendered newsletter HTML contains Mustache variables that are replaced per-recipient at send time:

| Variable | Source | Example |
|----------|--------|---------|
| `{{user.first_name}}` | `people.first_name` | "Dan" |
| `{{user.last_name}}` | `people.last_name` | "Smith" |
| `{{user.full_name}}` | Computed | "Dan Smith" |
| `{{user.email}}` | `people.email` | "dan@example.com" |
| `{{user.company}}` | `people.company` | "Gatewaze" |
| `{{unsubscribe_url}}` | Generated per-recipient | Encoded unsubscribe link |
| `{{subscription_center_url}}` | Portal URL | Link to subscription center |
| `{{view_in_browser_url}}` | Public edition URL | Web version of newsletter |

These variables are injected **after** the output adapter renders the edition HTML, as a final per-recipient pass.

#### 7.7 Admin Send History & Analytics

**Route: `/newsletters/sends`** (new tab in newsletters admin)

- List all newsletter sends with status, recipient count, schedule, completion time
- Click into a send to see:
  - Delivery metrics (sent, delivered, opened, clicked, bounced — from `email_logs` / `email_events`)
  - Unsubscribe count from this send
  - Link click tracking (from `newsletters_edition_links` + `redirects`)
- Cancel a scheduled send (sets status = 'cancelled')
- Duplicate a send config for re-sending to a different list

---

## API Design

### Template Collections API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/newsletters/template-collections` | List all collections |
| POST | `/api/newsletters/template-collections` | Create collection |
| GET | `/api/newsletters/template-collections/:id` | Get collection detail |
| PUT | `/api/newsletters/template-collections/:id` | Update collection |
| DELETE | `/api/newsletters/template-collections/:id` | Delete collection |
| POST | `/api/newsletters/template-collections/:id/duplicate` | Deep copy collection |
| PUT | `/api/newsletters/template-collections/:id/set-default` | Set as default |

### Block/Brick Template API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/newsletters/templates/blocks?collection_id=X&variant_key=Y` | List block templates |
| POST | `/api/newsletters/templates/blocks` | Create block template |
| GET | `/api/newsletters/templates/blocks/:id` | Get block template |
| PUT | `/api/newsletters/templates/blocks/:id` | Update block template |
| DELETE | `/api/newsletters/templates/blocks/:id` | Delete block template |
| GET | `/api/newsletters/templates/bricks?collection_id=X&variant_key=Y` | List brick templates |
| POST | `/api/newsletters/templates/bricks` | Create brick template |
| PUT | `/api/newsletters/templates/bricks/:id` | Update brick template |
| DELETE | `/api/newsletters/templates/bricks/:id` | Delete brick template |

### Template Upload & Export API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/newsletters/templates/parse-html` | Upload HTML file, returns parsed blocks/bricks/schemas (preview only, no DB write) |
| POST | `/api/newsletters/templates/import-html` | Import parsed blocks into a collection (writes to DB) |
| GET | `/api/newsletters/template-collections/:id/export-html?variant_key=Y` | Export collection as single HTML file with block comments |

**POST `/api/newsletters/templates/parse-html` request:** (multipart/form-data)
- `file`: The `.html` file

**Response:**
```json
{
  "globalStyles": "body { font-family: ... }",
  "blocks": [
    {
      "blockType": "header",
      "name": "Header",
      "html": "<table>...</table>",
      "hasBricks": false,
      "bricks": [],
      "schema": [
        { "key": "logo_url", "label": "Logo URL", "type": "image" },
        { "key": "header_title", "label": "Header Title", "type": "text" }
      ],
      "metadata": {}
    }
  ],
  "warnings": ["Line 42: Unclosed brick comment for 'podcast'"]
}
```

**POST `/api/newsletters/templates/import-html` request:**
```json
{
  "collection_id": "uuid",
  "variant_key": "html_template",
  "blocks": [...],
  "globalStyles": "...",
  "overwrite_existing": false
}
```

### Output Adapters API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/newsletters/output-adapters` | List installed output adapters |
| POST | `/api/newsletters/render` | Render edition with specific adapter |

**POST `/api/newsletters/render` request:**
```json
{
  "edition_id": "uuid",
  "adapter_id": "html",
  "collection_id": "uuid",
  "include_block_comments": false
}
```

**Response:**
```json
{
  "output": "<html>...</html>",
  "adapter": { "id": "html", "label": "HTML Email" },
  "warnings": []
}
```

### Newsletter Sending API (requires bulk-emailing module)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/newsletters/sends` | Create a newsletter send (immediate or scheduled) |
| GET | `/api/newsletters/sends` | List all sends with status and metrics |
| GET | `/api/newsletters/sends/:id` | Get send detail with delivery analytics |
| POST | `/api/newsletters/sends/:id/cancel` | Cancel a scheduled send |
| POST | `/api/newsletters/sends/:id/test` | Send test to specific email addresses |
| POST | `/api/newsletters/sends/:id/duplicate` | Duplicate send config for re-send |

**POST `/api/newsletters/sends` request:**
```json
{
  "edition_id": "uuid",
  "list_ids": ["community_newsletter", "members_newsletter"],
  "adapter_id": "html",
  "subject": "Weekly Community Update - March 30",
  "preheader": "This week's highlights...",
  "from_address": "newsletter@example.com",
  "from_name": "Community Team",
  "schedule": {
    "type": "scheduled",
    "scheduled_at": "2026-03-31T09:00:00Z"
  }
}
```

### Subscription Management API (public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/subscriptions/topics` | List active topic labels (public, for subscription center) |
| GET | `/api/subscriptions/status?email=X` | Get subscription status for a user (authenticated) |
| POST | `/api/subscriptions/track` | Subscribe/unsubscribe (wraps existing `people-track-subscription`) |
| POST | `/api/subscriptions/unsubscribe` | External unsubscribe (bearer auth) |
| GET | `/unsubscribe?token=X` | One-click unsubscribe from email link (public, no auth) |

---

## Data Models

### Template Collection

```typescript
interface TemplateCollection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  metadata: {
    globalStyles?: string;     // CSS extracted from uploaded HTML <style> tags
    primaryColor?: string;     // Brand color used in template previews
    fontFamily?: string;       // Default font family for the collection
    preheaderDefault?: string; // Default preheader text for email output
    [key: string]: unknown;    // Extensible for future collection-level config
  };
  created_at: string;
  updated_at: string;
}
```

### Block Template (extended)

```typescript
interface BlockTemplate {
  id: string;
  collection_id: string;
  name: string;
  block_type: string;
  variant_key: string; // 'html_template' | 'rich_text_template' | custom
  description: string | null;
  content: {
    template: string;        // The HTML/Mustache template string
    schema: FieldSchema[];   // Field definitions
    has_bricks: boolean;
  };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface FieldSchema {
  key: string;
  label: string;
  type: 'text' | 'richtext' | 'image' | 'url' | 'array' | 'boolean';
  required?: boolean;
  default?: unknown;
  arrayItemSchema?: FieldSchema[]; // For array-type fields
}
```

### Brick Template (extended)

```typescript
interface BrickTemplate {
  id: string;
  collection_id: string;
  name: string;
  brick_type: string;
  variant_key: string;
  description: string | null;
  content: {
    template: string;
    schema: FieldSchema[];
  };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

---

## Migration Plan

### Phase 1: Schema Changes

1. Create `newsletters_template_collections` table
2. Add `collection_id` and `variant_key` columns to `newsletters_block_templates` and `newsletters_brick_templates`
3. Add `collection_id` column to `newsletters_editions`
4. Create a "Default" template collection and backfill existing templates into it
5. Set existing editions to use the Default collection

### Phase 2: Output Adapter Extraction

1. Define `INewsletterOutputAdapter` interface in newsletters core
2. Extract HTML email generation from `htmlGenerator.ts` into `newsletters-output-html` module
3. Extract Substack generation into `newsletters-output-substack` module
4. Extract Beehiiv generation into `newsletters-output-beehiiv` module
5. Refactor `EditionCanvas.tsx` and `HtmlPreview.tsx` to use dynamic adapter discovery
6. Remove hardcoded `OutputFormat` type and switch statements

### Phase 3: Redirect Adapter Extraction

1. Define `IRedirectAdapter` interface
2. Refactor `linkService.ts` Short.io code into `redirects-shortio` adapter module
3. Update `linkGenerator.ts` to use adapter interface
4. Update newsletter link generation to use adapter pattern
5. Create `redirects-bitly` module as a second implementation (validates the interface)

### Phase 4: Template Management UI

1. Build Template Collections admin page (list, create, duplicate, delete)
2. Build Template Collection detail page with variant tabs
3. Build Block Template editor (Monaco + preview + schema editor)
4. Build Brick Template editor (same pattern)
5. Seed the Default collection with the existing hardcoded block/brick templates
6. Add collection selector to edition creation form

### Phase 5: Multi-Template Integration

1. Wire collection-aware template resolution into the rendering pipeline
2. Update block palette to filter by selected collection
3. Add collection switching on existing editions (with migration warnings)
4. Test end-to-end: create collection → add templates → create edition → render across all adapters

### Phase 6: Subscription Center & Unsubscribe

1. Add `category` column to `email_topic_labels` (migration)
2. Build portal Subscription Center page (`/subscriptions`)
3. Build public unsubscribe page (`/unsubscribe?token=X`)
4. Implement token encoding/decoding for unsubscribe links (upgrade from XOR to HMAC-based)
5. Add `List-Unsubscribe` and `List-Unsubscribe-Post` headers to sent emails (RFC 8058)
6. Build external unsubscribe API endpoint (`POST /api/subscriptions/unsubscribe`)
7. Test: unsubscribe via email link → verify `email_subscriptions` updated → verify Customer.io sync

### Phase 7: Newsletter Sending (requires bulk-emailing module)

1. Create `newsletter_sends` table (migration)
2. Build Send UI in edition editor (subject, list selector, schedule picker, preview)
3. Build `newsletter-send` edge function (render → batch → send via SendGrid)
4. Implement per-recipient variable injection (name, unsubscribe URL, etc.)
5. Build `newsletter-send-scheduler` edge function + `pg_cron` job for scheduled sends
6. Build Send History admin page (`/newsletters/sends`) with delivery analytics
7. Wire email_logs / email_events data into send analytics view
8. Test end-to-end: create edition → select list → schedule send → verify delivery → test unsubscribe

---

## Infrastructure Context

- **Runtime**: Admin UI is a Next.js app (Vercel). Server-side operations run as Supabase Edge Functions (Deno).
- **Database**: Supabase (PostgreSQL) with Row-Level Security.
- **Authentication**: Supabase Auth with JWT tokens. All newsletter API endpoints require an authenticated admin role.
- **Expected load**: Admin UI is 1-5 concurrent users. Template rendering is on-demand. Newsletter sending is the highest-throughput operation — batches of 50 recipients via SendGrid, potentially thousands of recipients per send. Sending is async (edge function) and does not block the admin UI. Portal subscription center is low-traffic (authenticated users managing preferences).

## Security Considerations

- **Template injection**: Block/brick templates are admin-authored Mustache HTML. Content values injected into templates are sanitized using `DOMPurify` (or equivalent) to prevent XSS. Mustache's default HTML-escaping (`{{variable}}`) provides baseline protection; triple-stache `{{{variable}}}` (unescaped) should be used sparingly and only for richtext fields that have already been sanitized on input.
- **API key storage**: Redirect adapter API keys (Short.io, Bitly) are stored in the `installed_modules.config` JSONB field, encrypted at rest via Supabase's column-level encryption. Keys are never exposed to the frontend — all adapter API calls are made server-side via Supabase Edge Functions.
- **RLS policies**: Template collections, block templates, and brick templates follow existing newsletter RLS policies (admin-only write, authenticated read for rendering).
- **Module permissions**: Only admins can install/configure output and redirect adapter modules.
- **HTML upload sanitization**: Uploaded HTML files are parsed server-side. The parser does not execute JavaScript or load external resources. File size is limited to 2MB.
- **Unsubscribe endpoint protection**: The public `/unsubscribe` endpoint is rate-limited (10 requests per minute per IP) to prevent abuse. Tokens are HMAC-signed (not guessable) and expire after 90 days. Invalid/expired tokens show a generic "link expired" page with a link to the subscription center.
- **Send authorization**: The `newsletter-send` edge function validates that the caller is an admin and that the edition is in a sendable state. Scheduled sends are processed by a service-role cron job, not user-invokable.

## Error Handling Strategy

- **Missing adapter**: If no output adapter is installed, the UI shows a clear message directing the admin to install one. The HTML adapter is installed by default with the newsletters module.
- **Missing redirect adapter**: Link generation gracefully degrades — links are preserved as original URLs with a warning toast: "No link shortener configured. Links will use original URLs."
- **Template resolution failure**: If a block has no matching template in the collection, fall back to a generic unstyled rendering with a warning badge on the block in the editor.
- **Adapter API failures**: Redirect adapters implement retry with exponential backoff (existing pattern in `linkService.ts`). After max retries, partial results are returned with per-link error status.
- **Rate limiting**: If a redirect adapter receives a 429 (Too Many Requests) response, it respects the `Retry-After` header and queues remaining links. The UI shows progress with a "rate limited, retrying..." status.

### API Error Response Format

All API endpoints return errors in a consistent format:

```json
{
  "error": {
    "code": "DUPLICATE_SLUG",
    "message": "A template collection with slug 'community' already exists.",
    "status": 409
  }
}
```

**Standard error codes:**

| HTTP Status | Error Code | When |
|------------|-----------|------|
| 400 | `INVALID_REQUEST` | Missing or malformed request body/params |
| 404 | `NOT_FOUND` | Resource (collection, template, adapter, edition) not found |
| 409 | `DUPLICATE_SLUG` | Collection slug or block_type+variant already exists |
| 409 | `COLLECTION_IN_USE` | Attempting to delete a collection referenced by editions |
| 422 | `PARSE_ERROR` | HTML upload contains unparseable or malformed block comments |
| 429 | `RATE_LIMITED` | Redirect adapter rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

## Performance Requirements

- Template editor preview should update within 500ms of code changes (client-side rendering, no API call)
- Newsletter rendering (all output formats) should complete within 3 seconds for a typical 10-block edition (server-side via Edge Function)
- Bulk link creation should handle up to 100 links per edition within 30 seconds (dependent on external API rate limits)
- Template collection listing should load within 200ms (Supabase query with index)
- HTML file parsing should complete within 2 seconds for files up to 2MB

## Observability

### Logging

- Log all create/update/delete operations for templates and collections at INFO level (includes admin user ID, collection ID, action)
- Log rendering operations at INFO level (edition ID, adapter ID, render duration)
- Log redirect adapter errors at ERROR level (adapter ID, link URL, error message, retry count)
- Log HTML upload parse results at INFO level (file size, block count, warning count)
- All logs flow through Supabase's built-in logging (accessible via Supabase Dashboard → Logs)

### Metrics

- **Render duration** per adapter (p50, p95, p99) — tracked via Edge Function execution time
- **Link creation success/failure rate** per redirect adapter
- **Template upload frequency** and parse warning rate
- Metrics are derived from logs via Supabase Log Explorer queries (no additional infrastructure needed)

### Alerting

- Alert on Edge Function error rate > 5% over 5 minutes (via Supabase alerting or external monitoring)
- Alert on redirect adapter failure rate > 10% (indicates API key expiry or service outage)

## Deployment Strategy

The newsletters module and its adapters deploy as part of the existing Gatewaze infrastructure:

1. **Module code**: All modules (newsletters core, output adapters, redirect adapters) live in the `premium-gatewaze-modules` repo. They are loaded dynamically by the Gatewaze admin app at runtime based on the `installed_modules` table.
2. **Database migrations**: Each module includes SQL migrations that run via the Gatewaze module installer when the module is first enabled.
3. **Edge Functions**: Server-side rendering and link creation APIs are Supabase Edge Functions (Deno). These are deployed via `supabase functions deploy` as part of the existing CI/CD pipeline.
4. **Rollback**: Module code can be rolled back by reverting the Git commit in `premium-gatewaze-modules`. Database migrations include down migrations for reversibility. Modules can be disabled via the admin UI which prevents their code from loading.
5. **Feature flags**: New features can be gated behind the module system's feature flags (e.g., `newsletters.templates` feature within the newsletters module) for gradual rollout.

## Testing Strategy

- **Unit tests**: Template resolution logic, Mustache rendering, link path generation, HTML template parser (comment extraction, schema inference)
- **Integration tests**: Output adapter rendering produces valid HTML, redirect adapter creates/deletes links via mocked external APIs
- **E2E tests**: Create collection → upload HTML template → verify blocks extracted → create edition → preview across adapters → generate links
- **Visual regression**: Screenshot comparison of rendered newsletters across output adapters
- **Parser edge cases**: Malformed comments, nested blocks, missing closing tags, empty blocks, blocks with no Mustache variables

## Open Questions / Future Considerations

1. **Template marketplace**: Should template collections be shareable/importable between Gatewaze instances?
2. **Version history**: Should template edits be versioned with rollback capability?
3. **Template inheritance**: Should collections be able to inherit from a parent collection and override specific templates?
4. **A/B testing**: Should the system support rendering two variants of a block for split testing?
5. **Scheduling integration**: How does the output adapter integrate with send scheduling (Customer.io campaigns, Substack publish API, Beehiiv API)?
6. **Concurrency**: For multi-admin scenarios, should template editing use optimistic locking (version field + conflict detection) or is last-write-wins acceptable?
