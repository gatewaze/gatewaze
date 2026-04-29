// SERVICE-ROLE OK: admin calendars CRUD; the calendars table is not yet
// part of the tenancy_v2 RLS rewrite. Per-route migration to
// getRequestSupabase() is deferred to phase 4 (Session 16) where
// integration tests against a real Supabase instance can validate the
// flag-on path.
import { getSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

export const calendarsRouter = labeledRouter('jwt');
calendarsRouter.use(requireJwt());

// List calendars
calendarsRouter.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
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
    console.error('Error fetching calendars:', err);
    res.status(500).json({ error: 'Failed to fetch calendars' });
  }
});

// Get single calendar with its events via calendar_events junction table
calendarsRouter.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
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
    console.error('Error fetching calendar:', err);
    res.status(500).json({ error: 'Failed to fetch calendar' });
  }
});

// Create calendar
calendarsRouter.post('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('calendars')
      .insert(req.body)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Error creating calendar:', err);
    res.status(500).json({ error: 'Failed to create calendar' });
  }
});

// Update calendar
calendarsRouter.patch('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('calendars')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Calendar not found' });

    res.json(data);
  } catch (err) {
    console.error('Error updating calendar:', err);
    res.status(500).json({ error: 'Failed to update calendar' });
  }
});
