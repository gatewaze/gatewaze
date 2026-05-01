// User-scoped Supabase per spec §5.1: every CRUD on the calendars
// table runs under the caller's JWT, so v1 RLS (admin or self) and
// v2 RLS (account_in_scope) both apply automatically. Service-role is
// no longer used here.
//
// First proof-of-concept route migrated from getSupabase() to
// getRequestSupabase(req). The pattern: every handler awaits the
// per-request client (which sets app.account_id GUC), and admin
// authorization is enforced by the v1 RLS policies (is_admin()).
import { getRequestSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';
import { logger } from '../lib/logger.js';

export const calendarsRouter = labeledRouter('jwt');
calendarsRouter.use(requireJwt());

// List calendars
calendarsRouter.get('/', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const search = req.query.search as string;
    const isPublic = req.query.public as string;

    let query = supabase
      .from('calendars')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) query = query.ilike('name', `%${search}%`);
    if (isPublic === 'true') query = query.eq('public', true);
    if (isPublic === 'false') query = query.eq('public', false);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data, total: count, page, limit });
  } catch (err) {
    logger.error({ err }, 'failed to fetch calendars');
    res.status(500).json({ error: 'Failed to fetch calendars' });
  }
});

// Get single calendar with its events via calendar_events junction table
calendarsRouter.get('/:id', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const identifier = req.params.id;

    // Look up by id, slug, or calendar_id (CAL-XXX format)
    let calendarQuery = supabase.from('calendars').select('*');

    if (identifier.startsWith('CAL-')) {
      calendarQuery = calendarQuery.eq('calendar_id', identifier);
    } else if (/^\d+$/.test(identifier)) {
      calendarQuery = calendarQuery.eq('id', identifier);
    } else {
      calendarQuery = calendarQuery.eq('slug', identifier);
    }

    const { data: calendar, error: calError } = await calendarQuery.single();
    if (calError) throw calError;
    if (!calendar) return res.status(404).json({ error: 'Calendar not found' });

    // Fetch associated events through junction table
    const { data: calendarEvents, error: eventsError } = await supabase
      .from('calendars_events')
      .select('events!inner(*)')
      .eq('calendar_id', calendar.id);

    if (eventsError) throw eventsError;

    const events = calendarEvents?.map((row: Record<string, unknown>) => row.events) ?? [];

    res.json({ ...calendar, events });
  } catch (err) {
    logger.error({ err }, 'failed to fetch calendar');
    res.status(500).json({ error: 'Failed to fetch calendar' });
  }
});

// Allowlist of fields callers may set on POST/PATCH. Internal columns
// (account_id, created_at, etc.) are excluded — the request body is
// untrusted and RLS alone shouldn't be the only line of defence against
// callers attempting mass-assignment of those fields.
const CALENDAR_WRITE_FIELDS = new Set([
  'name',
  'slug',
  'description',
  'visibility',
  'is_active',
  'external_url',
  'cover_image_url',
  'theme',
  'theme_colors',
  'category',
]);

function pickCalendarFields(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (CALENDAR_WRITE_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

// Create calendar
calendarsRouter.post('/', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const { data, error } = await supabase
      .from('calendars')
      .insert(pickCalendarFields(req.body))
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    logger.error({ err }, 'failed to create calendar');
    res.status(500).json({ error: 'Failed to create calendar' });
  }
});

// Update calendar
calendarsRouter.patch('/:id', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const { data, error } = await supabase
      .from('calendars')
      .update(pickCalendarFields(req.body))
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Calendar not found' });

    res.json(data);
  } catch (err) {
    logger.error({ err }, 'failed to update calendar');
    res.status(500).json({ error: 'Failed to update calendar' });
  }
});
