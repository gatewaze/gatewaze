# Technical Specification: Event Invites System — Grouped RSVP with Multi-Channel Delivery

## 1. Overview / Context

The Gatewaze platform needs a redesigned event invite system that supports **grouped invitations** (couples, families, parties) where a **lead booker** manages RSVPs for their entire group. Each person in a group may be invited to **different events** (e.g., day wedding vs evening reception, or conference main event vs specific workshops).

The system must support multiple invite creation methods (individual search, CSV import), multi-channel delivery (email, SMS, WhatsApp), per-person-per-event RSVP with configurable follow-up questions, short RSVP links with QR codes for printed materials, and a portal experience where lead bookers manage their party while navigating the wider event site.

### Target Use Cases

1. **Wedding**: Day event + evening reception. Guests invited as couples/families. Some attend both, some only evening. Meal preferences for day guests.
2. **Conference with workshops**: Main event + optional workshops. Some attendees invited to specific workshops.
3. **Corporate event**: Individual invites with plus-one allocation.

### Dependencies

- `events` module — event records, including an RPC for registration creation
- `bulk-emailing` module — email delivery
- `people-warehouse` module — people/profile records (optional)
- New: `twilio-sms` module — SMS delivery (future)
- New: `whatsapp` module — WhatsApp delivery (future)

---

## 2. Goals and Non-Goals

### Goals

- Support grouped invitations with a lead booker model
- Per-person, per-event attendance tracking and RSVP
- Configurable follow-up questions (meal preference, dietary requirements, etc.) per event
- Multiple invite creation: individual person search, CSV bulk import
- Multi-channel invite delivery: email (now), SMS and WhatsApp (future modules)
- **Short RSVP links** (~35 chars) suitable for SMS messages and printed materials
- **QR code generation** per party (or per member) for printing on physical invitations
- Portal-side RSVP experience where the invitee can also navigate the wider event pages
- Admin dashboard for managing parties, tracking RSVPs, and viewing aggregated responses

### Non-Goals

- Payment/ticketing integration (handled by existing registration system)
- Calendar sync (handled by existing `calendars` module)
- Real-time chat or messaging within the invite system
- Guest-initiated invite requests (admin-only creation)

---

## 3. System Architecture

### Module Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                      event-invites module                        │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────────────┐ │
│  │  Admin    │  │  Portal  │  │ Edge Functions                │ │
│  │  Tab UI   │  │  RSVP UI │  │  - event-invite-rsvp (public) │ │
│  └────┬─────┘  └────┬─────┘  │  - event-invite-admin (auth)  │ │
│       │              │        └──────────┬────────────────────┘ │
│       │              │                   │                      │
│       ▼              ▼                   ▼                      │
│  ┌──────────────────────────────────────────────┐               │
│  │           Supabase (PostgreSQL)               │               │
│  │  invite_parties, invite_party_members,        │               │
│  │  invite_party_member_events, invite_questions,│               │
│  │  invite_responses, event_invite_interactions  │               │
│  └──────────────────────────────────────────────┘               │
└──────────┬──────────────────┬──────────────────┬────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
     ┌──────────┐      ┌──────────────┐   ┌──────────────┐
     │  bulk-   │      │  twilio-sms  │   │  whatsapp    │
     │  emailing│      │  (future)    │   │  (future)    │
     └──────────┘      └──────────────┘   └──────────────┘
           │
           ▼
     ┌──────────────────────┐
     │   events module      │
     │  RPC: create_event_  │
     │  registration()      │
     └──────────────────────┘
```

### Key Architectural Decisions

1. **Two edge functions, not one:** `event-invite-rsvp` is public (anon, token-based) for portal RSVP. `event-invite-admin` is authenticated and handles complex operations (CSV import, bulk send, party creation with people record management) that are too complex for direct PostgREST queries.
2. **Registration via RPC:** The edge function does NOT write directly to `events_registrations`. It calls a Supabase RPC (`create_event_registration`) owned by the events module. This keeps module boundaries clean.
3. **Channel discovery at runtime:** The invite module checks installed modules to determine available delivery channels. No hard dependency on SMS/WhatsApp modules.

### Data Flow

1. **Admin creates invites** → Admin UI calls `event-invite-admin` edge function → creates people records, parties, members, event assignments in a transaction → returns party data with short codes
2. **Admin sends invites** → Admin UI calls `event-invite-admin` (action: `send`) → edge function triggers delivery via the appropriate channel module → updates party status to `sent`
3. **Invitee receives link** (email/SMS/WhatsApp) or scans QR code → visits `{portal}/i/{short_code}`
4. **Portal loads RSVP page** → calls `event-invite-rsvp` edge function (action: `load`) → returns party members, events, questions
5. **Lead booker submits RSVPs** → calls `event-invite-rsvp` (action: `submit`) → validates, stores responses, calls `create_event_registration` RPC for accepted invitees
6. **Admin views dashboard** → standard PostgREST queries against views (`invite_parties_with_stats`)

---

## 4. Data Models / Database Schema

### 4.1 `invite_parties`

A party is a group of people invited together (couple, family, individual).

```sql
CREATE TABLE public.invite_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                          -- "The Smith Family", "John & Jane Doe"
  token varchar(64) UNIQUE NOT NULL,           -- internal token (64-char hex)
  short_code varchar(12) UNIQUE NOT NULL,      -- public short link code (8-char base62)
  max_plus_ones integer DEFAULT 0,             -- how many unnamed guests can be added
  plus_ones_added integer DEFAULT 0,           -- current count of added plus-ones
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'send_failed', 'opened', 'partially_responded', 'responded', 'expired', 'cancelled')),
  delivery_channel text DEFAULT 'email'
    CHECK (delivery_channel IN ('email', 'sms', 'whatsapp')),
  sent_at timestamptz,
  opened_at timestamptz,
  responded_at timestamptz,
  notes text,                                  -- admin notes
  batch_id uuid REFERENCES public.event_invite_batches(id) ON DELETE SET NULL,
  version integer DEFAULT 1,                   -- optimistic locking for concurrent RSVP submissions
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Short code generation:** At party creation, the `event-invite-admin` edge function generates an 8-character base-62 code using `crypto.getRandomValues()`. On unique constraint violation, it retries with a new code (up to 3 attempts). The probability of collision with <1M parties is negligible (~1 in 218 billion).

### 4.2 `invite_party_members`

Each person in a party. Can be pre-populated by admin or added by lead booker (plus-ones).

```sql
CREATE TABLE public.invite_party_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.invite_parties(id) ON DELETE CASCADE,
  person_id uuid REFERENCES public.people(id), -- linked person record; source of truth for name/email when present
  first_name text,                              -- denormalized from people record, or standalone for plus-ones
  last_name text,
  email text,
  phone text,
  is_lead_booker boolean DEFAULT false,
  is_plus_one boolean DEFAULT false,            -- added by lead booker, not admin
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Data consistency rule:** When `person_id` is set, `first_name`, `last_name`, `email`, `phone` are copied from the `people`/`people_profiles_with_people` records at creation time as a denormalized cache. The `person_id` record is the source of truth. For `is_plus_one` members without a `person_id`, the fields on this table are the source of truth. When a plus-one is later linked to a person record, the `person_id` is set and fields are synced.

### 4.3 `invite_party_member_events`

Maps each party member to the specific events they are invited to, and tracks their RSVP per event.

```sql
CREATE TABLE public.invite_party_member_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_member_id uuid NOT NULL REFERENCES public.invite_party_members(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  rsvp_status text DEFAULT 'pending'
    CHECK (rsvp_status IN ('pending', 'accepted', 'declined', 'maybe')),
  rsvp_responded_at timestamptz,
  rsvp_deadline timestamptz,                   -- per-member-event RSVP deadline
  registration_id uuid REFERENCES public.events_registrations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_member_id, event_id)
);
```

### 4.4 `invite_questions`

Configurable follow-up questions per event (e.g., "Meal preference", "Dietary requirements").

```sql
CREATE TABLE public.invite_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  question_text text NOT NULL,                 -- "What is your meal preference?"
  question_type text NOT NULL DEFAULT 'select'
    CHECK (question_type IN ('select', 'multi_select', 'text', 'yes_no')),
  options jsonb,                               -- ["Chicken", "Fish", "Vegetarian", "Vegan"]
  is_required boolean DEFAULT false,
  applies_to text DEFAULT 'all'
    CHECK (applies_to IN ('all', 'accepted_only')),  -- only show if attending
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 4.5 `invite_responses`

Answers to follow-up questions, per party member per event.

```sql
CREATE TABLE public.invite_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_member_event_id uuid NOT NULL REFERENCES public.invite_party_member_events(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.invite_questions(id) ON DELETE CASCADE,
  answer jsonb NOT NULL,                       -- string for text/select, array for multi_select, boolean for yes_no
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_member_event_id, question_id)
);
```

### 4.6 `event_invite_interactions`

Click/open tracking per party.

```sql
CREATE TABLE public.event_invite_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.invite_parties(id) ON DELETE CASCADE,
  interaction_type text NOT NULL,              -- 'opened', 'rsvp_yes', 'rsvp_no', 'rsvp_maybe', 'link_click'
  ip_address inet,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_invite_interactions_party
  ON public.event_invite_interactions(party_id, created_at DESC);
```

### 4.7 Existing tables retained

- **`event_invite_batches`** — grouping of parties created together (e.g., "CSV import 2026-04-07"). No schema changes.

### 4.8 Migration from existing `event_invites` table

The existing `event_invites` table is replaced by the new party-based model. A migration will:

1. For each existing `event_invites` row, create an `invite_parties` row (single-person party)
2. Create a corresponding `invite_party_members` row (is_lead_booker = true)
3. Create an `invite_party_member_events` row linking to the original event
4. Map existing RSVP status to the new `rsvp_status` field
5. Rename old `event_invites` table to `event_invites_legacy` (kept for 30 days, then dropped)

### 4.9 Views

```sql
-- Aggregated party view for admin dashboard
CREATE VIEW invite_parties_with_stats AS
SELECT
  p.*,
  COUNT(DISTINCT pm.id) AS member_count,
  COUNT(DISTINCT pme.id) FILTER (WHERE pme.rsvp_status = 'accepted') AS accepted_count,
  COUNT(DISTINCT pme.id) FILTER (WHERE pme.rsvp_status = 'declined') AS declined_count,
  COUNT(DISTINCT pme.id) FILTER (WHERE pme.rsvp_status = 'pending') AS pending_count,
  lb.first_name AS lead_first_name,
  lb.last_name AS lead_last_name,
  lb.email AS lead_email,
  array_agg(DISTINCT pme.event_id) FILTER (WHERE pme.event_id IS NOT NULL) AS event_ids
FROM invite_parties p
LEFT JOIN invite_party_members pm ON pm.party_id = p.id
LEFT JOIN invite_party_member_events pme ON pme.party_member_id = pm.id
LEFT JOIN invite_party_members lb ON lb.party_id = p.id AND lb.is_lead_booker = true
GROUP BY p.id, lb.first_name, lb.last_name, lb.email;

-- Per-member-event detail view for portal RSVP page
CREATE VIEW invite_party_detail AS
SELECT
  pm.id AS member_id,
  pm.party_id,
  pm.first_name,
  pm.last_name,
  pm.email,
  pm.is_lead_booker,
  pm.is_plus_one,
  pme.id AS member_event_id,
  pme.event_id,
  pme.rsvp_status,
  pme.rsvp_deadline,
  e.event_title,
  e.event_start,
  e.event_end,
  e.event_location,
  p.token AS party_token,
  p.short_code AS party_short_code,
  p.name AS party_name,
  p.status AS party_status,
  p.max_plus_ones,
  p.plus_ones_added
FROM invite_party_members pm
JOIN invite_parties p ON p.id = pm.party_id
LEFT JOIN invite_party_member_events pme ON pme.party_member_id = pm.id
LEFT JOIN events e ON e.id = pme.event_id;
```

---

## 5. API Design

### 5.1 Edge Function: `event-invite-rsvp` (Public — anon, token/short-code auth)

#### `POST /event-invite-rsvp`

**Action: `load`** — Load party details for the RSVP portal page. Accepts either `token` (64-char) or `short_code` (8-char).

```json
// Request
{
  "action": "load",
  "token": "Xk9mPq2R"
}

// Response (200)
{
  "party": {
    "id": "uuid",
    "name": "The Smith Family",
    "status": "sent",
    "max_plus_ones": 2,
    "plus_ones_added": 0,
    "version": 1
  },
  "members": [
    {
      "id": "uuid",
      "first_name": "John",
      "last_name": "Smith",
      "is_lead_booker": true,
      "is_plus_one": false,
      "events": [
        {
          "member_event_id": "uuid",
          "event_id": "uuid",
          "event_title": "Day Wedding",
          "event_start": "2026-06-15T14:00:00Z",
          "event_location": "St Mary's Church",
          "rsvp_status": "pending",
          "questions": [
            {
              "id": "uuid",
              "question_text": "Meal preference",
              "question_type": "select",
              "options": ["Chicken", "Fish", "Vegetarian", "Vegan"],
              "is_required": true,
              "current_answer": null
            }
          ]
        },
        {
          "member_event_id": "uuid",
          "event_id": "uuid",
          "event_title": "Evening Reception",
          "rsvp_status": "pending",
          "questions": []
        }
      ]
    },
    {
      "id": "uuid",
      "first_name": "Jane",
      "last_name": "Smith",
      "is_lead_booker": false,
      "is_plus_one": false,
      "events": [
        {
          "member_event_id": "uuid",
          "event_id": "uuid",
          "event_title": "Evening Reception",
          "rsvp_status": "pending",
          "questions": []
        }
      ]
    }
  ]
}

// Error Responses
// 404: { "error": "INVITE_NOT_FOUND", "message": "This invite link is not valid." }
// 410: { "error": "INVITE_EXPIRED", "message": "This invite has expired." }
// 403: { "error": "INVITE_CANCELLED", "message": "This invite has been cancelled." }
// 429: { "error": "RATE_LIMITED", "message": "Too many requests. Please try again later." }
```

**Action: `submit`** — Submit RSVPs for the entire party. Supports creating new plus-ones and editing existing ones.

```json
// Request
{
  "action": "submit",
  "token": "Xk9mPq2R",
  "version": 1,
  "responses": [
    {
      "member_event_id": "uuid",
      "rsvp_status": "accepted",
      "answers": [
        { "question_id": "uuid", "answer": "Chicken" }
      ]
    },
    {
      "member_event_id": "uuid",
      "rsvp_status": "declined",
      "answers": []
    }
  ],
  "new_plus_ones": [
    {
      "first_name": "Tommy",
      "last_name": "Smith",
      "event_ids": ["uuid"],
      "rsvp_statuses": { "uuid": "accepted" },
      "answers": [
        { "event_id": "uuid", "question_id": "uuid", "answer": "Chicken" }
      ]
    }
  ]
}

// Response (200)
{
  "success": true,
  "version": 2,
  "summary": {
    "accepted": 3,
    "declined": 1,
    "plus_ones_added": 1
  }
}

// Error Responses
// 400: { "error": "VALIDATION_ERROR", "message": "...", "fields": [{ "member_event_id": "uuid", "question_id": "uuid", "error": "Required question not answered" }] }
// 400: { "error": "PLUS_ONE_LIMIT", "message": "Maximum of 2 plus-ones allowed. You have requested 3." }
// 400: { "error": "DEADLINE_PASSED", "message": "The RSVP deadline has passed for one or more events.", "locked_events": ["uuid"] }
// 409: { "error": "VERSION_CONFLICT", "message": "This RSVP has been updated since you loaded it. Please reload and try again." }
// 404/410/403/429: same as load
```

**Action: `track`** — Track interactions (page open, link click).

```json
// Request
{ "action": "track", "token": "Xk9mPq2R", "interaction_type": "opened" }

// Response (200)
{ "success": true }
```

### 5.2 Edge Function: `event-invite-admin` (Authenticated — admin only)

Handles complex multi-step operations that cannot be expressed as simple PostgREST queries.

#### `POST /event-invite-admin`

**Action: `create-party`** — Create a party with members and event assignments. Creates `people` records for new contacts.

```json
// Request
{
  "action": "create-party",
  "name": "The Smith Family",
  "max_plus_ones": 2,
  "delivery_channel": "email",
  "notes": "Table 5",
  "members": [
    {
      "person_id": null,
      "first_name": "John",
      "last_name": "Smith",
      "email": "john@example.com",
      "phone": "+447700900000",
      "is_lead_booker": true,
      "event_ids": ["uuid-day", "uuid-evening"]
    },
    {
      "person_id": "existing-uuid",
      "is_lead_booker": false,
      "event_ids": ["uuid-evening"]
    }
  ]
}

// Response (201)
{
  "party": {
    "id": "uuid",
    "short_code": "Xk9mPq2R",
    "rsvp_url": "https://events.example.com/i/Xk9mPq2R",
    "member_count": 2
  },
  "people_created": ["john@example.com"]
}

// Error Responses
// 400: { "error": "VALIDATION_ERROR", "message": "..." }
// 409: { "error": "DUPLICATE_MEMBER", "message": "john@example.com is already in another party for these events." }
```

**Action: `import-csv`** — Bulk import parties from parsed CSV data.

```json
// Request
{
  "action": "import-csv",
  "event_ids": ["uuid-day", "uuid-evening"],
  "rows": [
    {
      "party_name": "The Smith Family",
      "first_name": "John",
      "last_name": "Smith",
      "email": "john@example.com",
      "phone": "+447700900000",
      "events": ["day", "evening"]
    },
    {
      "party_name": "The Smith Family",
      "first_name": "Jane",
      "last_name": "Smith",
      "email": "jane@example.com",
      "events": ["evening"]
    }
  ],
  "event_mapping": {
    "day": "uuid-day",
    "evening": "uuid-evening"
  }
}

// Response (200)
{
  "success": true,
  "parties_created": 1,
  "members_created": 2,
  "people_created": 2,
  "skipped": [],
  "errors": []
}
```

**Action: `send`** — Trigger invite delivery for parties in `draft` status.

```json
// Request
{
  "action": "send",
  "party_ids": ["uuid1", "uuid2"],
  "template_id": "uuid"
}

// Response (200)
{
  "success": true,
  "sent": 2,
  "failed": 0,
  "errors": []
}
```

### 5.3 Admin Read Operations (Supabase PostgREST — authenticated)

Simple read operations use standard PostgREST queries:

| Operation | Table/View | Method |
|-----------|-----------|--------|
| List parties for event | `invite_parties_with_stats` WHERE `event_ids @> ARRAY[uuid]` | SELECT |
| View party detail | `invite_party_detail` WHERE `party_id = uuid` | SELECT |
| List questions for event | `invite_questions` WHERE `event_id = uuid` ORDER BY `sort_order` | SELECT |
| View responses | `invite_responses` joined with questions and members | SELECT |
| Search people | `people_profiles_with_people` with `ilike` | SELECT |
| Configure questions | `invite_questions` | INSERT/UPDATE/DELETE |

---

## 6. Component Design

### 6.1 Admin: Invite Management Tab (`EventInvitesTab`)

Renders as a tab on the event detail page. Shows:

1. **Summary cards** — total parties, total people, accepted/declined/pending counts, response rate %
2. **Party list table** — party name, lead booker, member count, events, RSVP status, short code, actions
3. **Actions**: Create party, Import CSV, Send invites (bulk), Export responses, Bulk download QR codes

### 6.2 Admin: Create Party Modal

Two modes:

**Individual mode:**
- Search existing people (typeahead against `people_profiles_with_people`)
- Add new person inline (first_name, last_name, email, phone)
- If person doesn't exist, the `event-invite-admin` edge function creates `people` + `people_profiles` records
- Assign each member to events (checkboxes for available events)
- Set lead booker (first member by default)
- Configure plus-one allowance
- Choose delivery channel (email/SMS/WhatsApp — only shows available channels)

**CSV Import mode:**
- Upload CSV file (parsed client-side)
- Column mapping UI (map CSV columns to: first_name, last_name, email, phone, party_name, events)
- Preview parsed data before import (table showing parties, members, event assignments)
- Party grouping: rows with same `party_name` grouped into one party; first row in group becomes lead booker
- Submit parsed data to `event-invite-admin` edge function for server-side processing
- Shows import summary (created, skipped duplicates, errors)

### 6.3 Admin: Question Configuration

Per-event question builder accessible from the event detail page:

- Add/edit/delete/reorder questions (drag-and-drop)
- Question types: single select, multi-select, free text, yes/no
- Configure options for select types
- Mark as required or optional
- Set "applies to" (all invitees or accepted-only)

### 6.4 Admin: Response Dashboard

- Aggregated view of responses per question (e.g., "Chicken: 45, Fish: 23, Vegetarian: 12")
- Filterable by event, party, RSVP status
- Exportable to CSV
- Per-party drill-down showing individual member responses

### 6.5 Admin: QR Code Management

- "Download QR" button per party row in the admin table
- Bulk QR export: generate a ZIP of QR code PNGs named `{party_name}.png`
- Configurable QR style: size, color, optional logo overlay (event branding in centre)
- Print-ready resolution: 300 DPI minimum, SVG export option
- QR codes encode the short RSVP URL: `https://{portal_domain}/i/{short_code}`
- Generated client-side using `qrcode.react` or `qr-code-styling` — no images stored in DB

### 6.6 Portal: RSVP Page

Accessible via `/i/{short_code}` (short link) or `/invite/{token}` (legacy).

**Entry flow:**
1. Short code / token is resolved to a party via the `event-invite-rsvp` edge function
2. The portal loads the **event page** for the party's primary event (first event the lead booker is invited to)
3. An RSVP panel/section is presented within the context of the event page
4. The invitee can **navigate the wider event portal** — view the event schedule, speakers, venue info, other event pages — while their invite context is preserved

**RSVP experience:**
1. **Party header** — "You're invited!" with party name and event branding
2. **Per-member section** — each party member listed, grouped by the event(s) they're invited to. Clear labels showing which event each person is attending (e.g., "Day Ceremony", "Evening Reception")
3. **RSVP controls** — attend/decline per person per event
4. **Follow-up questions** — shown conditionally when "attend" is selected for an event
5. **Plus-one section** — if `max_plus_ones > plus_ones_added`, form to add guest details, assign to events, and answer their questions. Existing plus-ones can be edited.
6. **Submit button** — saves all responses in one transaction
7. **Confirmation page** — summary of who's attending what, with a link to continue browsing the event portal

**Navigation context:**
- The invite short code is stored in the portal's `localStorage` so the invitee can navigate away and return to their RSVP
- A persistent banner or floating button ("Your RSVP") is shown on all event pages while the invite session is active
- If the invitee has already responded, the banner shows their response summary with an "Edit RSVP" option

---

## 7. Short Links & QR Codes

### Short Code Design

The 64-character hex token is for internal use. For user-facing links, we generate an **8-character base-62 code** (`[a-zA-Z0-9]`), giving ~218 trillion combinations.

The public RSVP URL is:

```
https://{portal_domain}/i/{short_code}
```

Example: `https://events.example.com/i/Xk9mPq2R` (~35 characters).

**Generation:** At party creation, the `event-invite-admin` edge function generates the code using `crypto.getRandomValues()` mapped to the base-62 alphabet. On unique constraint violation, it retries (up to 3 attempts). Collision probability at <1M parties is ~1 in 218 billion per attempt.

**Resolution:** The portal route `/i/:code` and the edge function both accept either format. The edge function queries `WHERE short_code = $1 OR token = $1` (short codes are always ≤12 chars; tokens are always 64 chars, so there's no ambiguity).

### QR Code Generation

QR codes are generated **client-side** in the admin UI. They encode the short RSVP URL.

**Scope:**
- **Per party** (default) — one QR code for the lead booker's link
- **Per member** (optional, for conferences) — individual QR codes if members have individual short codes (requires `short_code` on `invite_party_members` — see Open Questions)

**Features:**
- Download individual QR as PNG or SVG
- Bulk export as ZIP (`{party_name}.png`)
- Configurable: size, foreground color, optional centre logo
- 300 DPI minimum for print

---

## 8. Multi-Channel Delivery

### 8.1 Email (via `bulk-emailing` module)

When admin triggers "Send Invites" via the `event-invite-admin` edge function:

1. For each party with `delivery_channel = 'email'`, creates a send job via `email_batch_jobs`
2. Template variables: `party_name`, `lead_first_name`, `lead_last_name`, `rsvp_link` (short URL), `event_title`, `event_date`, `event_location`, `member_names`
3. Updates party status to `sent` and records `sent_at`

### 8.2 SMS (via future `twilio-sms` module)

**Module interface contract:**

```typescript
interface SmsDeliveryRequest {
  to: string;           // E.164 format
  body: string;         // message text including short RSVP URL
  metadata: { party_id: string; delivery_type: 'invite' };
}

interface DeliveryResult {
  success: boolean;
  provider_id?: string;  // Twilio SID
  error?: string;
}
```

### 8.3 WhatsApp (via future `whatsapp` module)

```typescript
interface WhatsAppDeliveryRequest {
  to: string;           // E.164 format
  template_name: string;
  template_variables: Record<string, string>;
  metadata: { party_id: string; delivery_type: 'invite' };
}
```

### 8.4 Channel Discovery

Available channels are discovered at runtime by querying the `installed_modules` table:

```typescript
async function getAvailableChannels(): Promise<string[]> {
  const channels = ['email']; // always available via bulk-emailing dependency
  const { data: modules } = await supabase
    .from('installed_modules')
    .select('module_id')
    .in('module_id', ['twilio-sms', 'whatsapp'])
    .eq('status', 'enabled');
  for (const mod of modules || []) {
    if (mod.module_id === 'twilio-sms') channels.push('sms');
    if (mod.module_id === 'whatsapp') channels.push('whatsapp');
  }
  return channels;
}
```

### 8.5 Delivery Failure & Retry

- **Email:** Handled by the bulk-emailing module's existing retry logic. Failures surface in the admin dashboard via `email_batch_jobs` status.
- **SMS/WhatsApp:** The channel module is responsible for retry logic (up to 3 attempts with exponential backoff). If all retries fail, the party's `status` remains `draft` and the error is logged. Admin can retry or switch channel.
- **No automatic cross-channel fallback.** Admin must manually change `delivery_channel` and re-send. This avoids unexpected costs (e.g., SMS charges for an email invite).

---

## 9. Security Considerations

### 9.1 Token & Short Code Security

- Internal tokens: 64-character cryptographically random hex (256 bits entropy)
- Short codes: 8-character base-62 (47.6 bits entropy) — sufficient for non-sensitive invite links
- Both grant access to view and respond to invitations — no authentication required
- Tokens/short codes are reusable — lead booker can revisit and update responses until expired/cancelled
- Tokens can be revoked by admin (status → `cancelled`)

### 9.2 Rate Limiting

The `event-invite-rsvp` edge function enforces rate limits per token:
- **10 requests per minute** per token for `load` and `track` actions
- **3 requests per minute** per token for `submit` action
- Implementation: Supabase edge function checks against a sliding window counter in the `event_invite_interactions` table (count interactions in last 60 seconds)

### 9.3 RLS Policies

- **Authenticated (admin):** Full CRUD on all invite tables. In practice, complex writes go through the `event-invite-admin` edge function (which uses the service role key), so RLS is bypassed for those operations. Direct PostgREST access by authenticated admins is read-only for dashboard views.
- **Anon:** No direct PostgREST access to any invite tables. All portal interactions go through `event-invite-rsvp` edge function (service role key).
- **Service role usage is confined to edge functions** — never exposed to client-side code.

```sql
-- Admin: read access for dashboard views
CREATE POLICY "authenticated_select_invite_parties"
  ON public.invite_parties FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_select_invite_party_members"
  ON public.invite_party_members FOR SELECT TO authenticated USING (true);
-- ... similar for all invite tables

-- Admin: write access only for simple operations (questions, notes)
CREATE POLICY "authenticated_manage_invite_questions"
  ON public.invite_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon: no access (edge functions use service role)
-- No anon policies needed
```

### 9.4 Data Privacy

- Phone numbers stored for SMS/WhatsApp delivery — subject to GDPR/privacy policies
- RSVP responses may contain dietary/health information — treat as sensitive
- Admin-only access to response data; portal users only see their own party
- Short codes do not encode any PII — they are random identifiers

### 9.5 Input Validation

- Email format validation (RFC 5322) on all email fields
- Phone number validation (E.164 format) for SMS/WhatsApp — reject if not valid when channel requires it
- CSV import: sanitize all text inputs (trim whitespace, strip control characters), reject rows with invalid email format
- RSVP submission: validate all `member_event_id` values belong to the token's party (prevent IDOR)
- Plus-one count validation: reject if `plus_ones_added + new_plus_ones > max_plus_ones`
- Optimistic locking: `version` field prevents lost updates on concurrent submissions

---

## 10. Error Handling Strategy

| Scenario | HTTP Status | Error Code | Response |
|----------|-------------|------------|----------|
| Invalid token/short code | 404 | `INVITE_NOT_FOUND` | `{ "error": "INVITE_NOT_FOUND", "message": "This invite link is not valid." }` |
| Expired invite | 410 | `INVITE_EXPIRED` | `{ "error": "INVITE_EXPIRED", "message": "This invite has expired." }` |
| RSVP deadline passed | 400 | `DEADLINE_PASSED` | `{ "error": "DEADLINE_PASSED", "message": "The RSVP deadline has passed for one or more events.", "locked_events": ["uuid"] }` |
| Cancelled invite | 403 | `INVITE_CANCELLED` | `{ "error": "INVITE_CANCELLED", "message": "This invite has been cancelled." }` |
| Version conflict | 409 | `VERSION_CONFLICT` | `{ "error": "VERSION_CONFLICT", "message": "Please reload and try again." }` |
| Plus-one limit exceeded | 400 | `PLUS_ONE_LIMIT` | `{ "error": "PLUS_ONE_LIMIT", "message": "Maximum of N plus-ones allowed." }` |
| Required question unanswered | 400 | `VALIDATION_ERROR` | `{ "error": "VALIDATION_ERROR", "fields": [...] }` |
| Invalid member_event_id | 400 | `INVALID_REFERENCE` | `{ "error": "INVALID_REFERENCE", "message": "..." }` |
| Rate limited | 429 | `RATE_LIMITED` | `{ "error": "RATE_LIMITED", "message": "Too many requests." }` |
| Email delivery failure | — | — | Logged in `email_batch_jobs`; surfaced in admin dashboard |
| SMS/WhatsApp failure | — | — | Channel module retries; error stored on party record |
| CSV invalid rows | 200 | — | Partial success: `{ "errors": [{ "row": 3, "reason": "Invalid email" }] }` |
| Person already exists | — | — | Link to existing record; no duplicate created |

---

## 11. Performance Requirements

| Metric | Target |
|--------|--------|
| RSVP page load (`load` action) | < 500ms p95 |
| RSVP submission (`submit` action) | < 1s p95 |
| Admin party list (100 parties) | < 1s |
| CSV import (1000 rows) | < 30s |
| Concurrent RSVP submissions | 50 simultaneous |
| QR code generation (client-side, 100 codes) | < 5s |

### Indexes

```sql
CREATE INDEX idx_invite_parties_token ON invite_parties(token);
CREATE INDEX idx_invite_parties_short_code ON invite_parties(short_code);
CREATE INDEX idx_invite_parties_batch ON invite_parties(batch_id);
CREATE INDEX idx_invite_parties_status ON invite_parties(status);
CREATE INDEX idx_invite_party_members_party ON invite_party_members(party_id);
CREATE INDEX idx_invite_party_members_person ON invite_party_members(person_id);
CREATE INDEX idx_invite_party_member_events_member ON invite_party_member_events(party_member_id);
CREATE INDEX idx_invite_party_member_events_event ON invite_party_member_events(event_id);
CREATE INDEX idx_invite_questions_event ON invite_questions(event_id);
CREATE INDEX idx_invite_responses_member_event ON invite_responses(party_member_event_id);
CREATE INDEX idx_event_invite_interactions_party ON event_invite_interactions(party_id, created_at DESC);
```

---

## 12. Observability

- **Logging:** Both edge functions log all actions with `party_id`, action type, and outcome (success/error code)
- **Metrics:**
  - Invite send rate by channel (email/sms/whatsapp)
  - RSVP response rate and median time-to-respond
  - Error rates by action and error code
  - Edge function latency percentiles (p50, p95, p99)
- **Admin dashboard:** Real-time RSVP status counts, response aggregations, delivery status per party

---

## 13. Testing Strategy

| Layer | Approach |
|-------|----------|
| Database | Migration tests: verify tables, views, RLS policies, constraints, indexes |
| Edge functions | Unit tests for each action with mock Supabase client. Test all error scenarios. |
| Admin UI | Component tests for party creation, CSV import parsing, question builder, QR generation |
| Portal UI | E2E tests for full RSVP flow: load → respond → confirm → edit |
| Integration | End-to-end email delivery in staging. SMS/WhatsApp delivery with test numbers. |
| CSV import | Malformed CSVs, duplicate emails, missing fields, unicode, >1000 rows |
| Security | Token enumeration resistance (timing-safe lookups), rate limit enforcement, IDOR checks on member_event_id |
| Performance | Load test: 50 concurrent RSVP submissions against edge function |

---

## 14. Deployment Strategy

1. **Migration:** `003_invite_parties.sql` — creates new tables, views, indexes, RLS policies
2. **Data migration:** `004_migrate_existing_invites.sql` — migrates `event_invites` data to party model, renames old table to `event_invites_legacy`
3. **Edge functions:** Deploy `event-invite-rsvp` (updated) and `event-invite-admin` (new)
4. **Admin UI:** Deploy new `EventInvitesTab` component (replaces existing)
5. **Portal UI:** Deploy RSVP page and `/i/:code` route
6. **Cleanup:** `005_drop_legacy_invites.sql` — drops `event_invites_legacy` after 30 days

### Module configuration update

```typescript
// event-invites/index.ts
migrations: [
  'migrations/001_event_invites.sql',
  'migrations/002_event_invite_tables.sql',
  'migrations/003_invite_parties.sql',
  'migrations/004_migrate_existing_invites.sql',
],
edgeFunctions: [
  'event-invite-rsvp',
  'event-invite-admin',
],
dependencies: ['events', 'bulk-emailing'],
// twilio-sms and whatsapp are optional — discovered at runtime
```

---

## 15. RSVP Deadlines

Each `invite_party_member_events` row has an optional `rsvp_deadline` (defined in the schema above in section 4.3).

- **Portal enforcement:** The `event-invite-rsvp` edge function checks `rsvp_deadline` per member-event. If past the deadline, that member-event is locked (shown as "RSVP closed" in the portal). Other member-events in the same party may still be open.
- **Admin default:** When assigning members to an event, the deadline defaults to the event's `event_start` minus a configurable offset (e.g., 14 days before). Admins can override per member-event.
- **Edit window:** Lead bookers can change their RSVP responses at any time up until the deadline. After the deadline, responses are locked and the `submit` action returns `DEADLINE_PASSED` for those member-events.

---

## 16. Reminder System

Automated reminders for parties that haven't fully responded, integrated with the bulk-emailing module.

### Reminder Configuration (per event)

```sql
CREATE TABLE public.invite_reminder_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  days_before_deadline integer NOT NULL,       -- e.g., 7 = remind 7 days before deadline
  template_id uuid,                            -- email template from bulk-emailing
  sms_template text,                           -- SMS message template (for SMS channel)
  enabled boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, days_before_deadline)
);

-- Track which parties have received which reminders
CREATE TABLE public.invite_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_config_id uuid NOT NULL REFERENCES public.invite_reminder_config(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES public.invite_parties(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivery_channel text NOT NULL,
  UNIQUE (reminder_config_id, party_id)
);
```

### Reminder Logic

A scheduled edge function (`event-invite-reminders`) runs daily:

1. For each enabled `invite_reminder_config` row:
2. Find all parties that have at least one member-event with `rsvp_status = 'pending'` for that event AND whose `rsvp_deadline` is within `days_before_deadline` days from now
3. Exclude parties already in `invite_reminder_log` for this config (already reminded)
4. Send reminders via each party's `delivery_channel` (email/SMS/WhatsApp)
5. Record each send in `invite_reminder_log`

### Admin UI

Reminder configuration is part of the question/settings section on the event detail page:
- Add reminder rules: "Send reminder 14 days before deadline", "Send reminder 3 days before deadline"
- Select template per reminder
- View which reminders have been sent

---

## 17. Open Questions / Future Considerations

1. **Per-member short codes:** For conferences, individual attendees may need their own QR code/short link. This would require adding `short_code` to `invite_party_members`. Deferred until the conference use case is more concrete.
2. **Seating assignments:** Potential future module that builds on invite responses for table planning. Not in scope.
