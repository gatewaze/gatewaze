// User-scoped Supabase per spec §5.1. The v1 people RLS lets admins
// see all rows + users see their own; v2 scopes by account_in_scope.
import { getRequestSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';
import { logger } from '../lib/logger.js';

export const peopleRouter = labeledRouter('jwt');
peopleRouter.use(requireJwt());

// List people with search and pagination
peopleRouter.get('/', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const search = req.query.search as string;
    const status = req.query.status as string;

    let query = supabase
      .from('people')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) {
      // PostgREST .or() takes a comma-separated filter string. Strip
      // characters that have meaning in that grammar before interpolating
      // — without this, a search value containing a `,` or `(` can inject
      // additional disjunction clauses (e.g. `%x%,id.gt.0` would return
      // every row in the table).
      const safe = search.replace(/[,()*\\]/g, '').slice(0, 100);
      if (safe) {
        query = query.or(
          `email.ilike.%${safe}%,attributes->>first_name.ilike.%${safe}%,attributes->>last_name.ilike.%${safe}%,attributes->>company.ilike.%${safe}%`
        );
      }
    }

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data, total: count, page, limit });
  } catch (err) {
    logger.error({ err }, 'failed to fetch people');
    res.status(500).json({ error: 'Failed to fetch people' });
  }
});

// Get single person
peopleRouter.get('/:id', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const { data, error } = await supabase
      .from('people')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Person not found' });

    res.json(data);
  } catch (err) {
    logger.error({ err }, 'failed to fetch person');
    res.status(500).json({ error: 'Failed to fetch person' });
  }
});

// Allowlist of fields a POST /people caller may set. Internal columns
// (account_id, created_at, auth_user_id, etc.) are deliberately excluded
// — RLS shouldn't be the only line of defence against mass-assignment.
const PERSON_WRITE_FIELDS = new Set([
  'email',
  'first_name',
  'last_name',
  'phone',
  'attributes',
  'status',
  'is_guest',
  'cio_id',
]);

// Create person
peopleRouter.post('/', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const insert: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (PERSON_WRITE_FIELDS.has(k)) insert[k] = v;
    }
    const { data, error } = await supabase
      .from('people')
      .insert(insert)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    logger.error({ err }, 'failed to create person');
    res.status(500).json({ error: 'Failed to create person' });
  }
});

// Update person
peopleRouter.patch('/:id', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const { data, error } = await supabase
      .from('people')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Person not found' });

    res.json(data);
  } catch (err) {
    logger.error({ err }, 'failed to update person');
    res.status(500).json({ error: 'Failed to update person' });
  }
});

// Delete person
peopleRouter.delete('/:id', async (req, res) => {
  try {
    const supabase = getRequestSupabase(req);
    const { error } = await supabase
      .from('people')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'failed to delete person');
    res.status(500).json({ error: 'Failed to delete person' });
  }
});
