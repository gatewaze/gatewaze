// SERVICE-ROLE OK: admin people CRUD; the v1 people RLS already lets
// admins see all rows so a switch to user-scoped (getRequestSupabase)
// would behave correctly today, but the v2 path requires `account_id`
// on every people row — the backfill (Session 6) populates that, then
// Session 16 migrates this file under integration test coverage.
import { getSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';
import { logger } from '../lib/logger.js';

export const peopleRouter = labeledRouter('jwt');
peopleRouter.use(requireJwt());

// List people with search and pagination
peopleRouter.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
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
      query = query.or(
        `email.ilike.%${search}%,attributes->>first_name.ilike.%${search}%,attributes->>last_name.ilike.%${search}%,attributes->>company.ilike.%${search}%`
      );
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
    const supabase = getSupabase();
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

// Create person
peopleRouter.post('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('people')
      .insert(req.body)
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
    const supabase = getSupabase();
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
    const supabase = getSupabase();
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
