import { Router } from 'express';
import { getSupabase } from '../lib/supabase.js';

export const registrationsRouter = Router();

// List registrations (optionally filtered by event_id)
registrationsRouter.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const eventId = req.query.event_id as string;
    const status = req.query.status as string;

    let query = supabase
      .from('event_registrations')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (eventId) query = query.eq('event_id', eventId);
    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data, total: count, page, limit });
  } catch (err) {
    console.error('Error fetching registrations:', err);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

// Get single registration
registrationsRouter.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('event_registrations')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Registration not found' });

    res.json(data);
  } catch (err) {
    console.error('Error fetching registration:', err);
    res.status(500).json({ error: 'Failed to fetch registration' });
  }
});

// Create registration
registrationsRouter.post('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('event_registrations')
      .insert(req.body)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Error creating registration:', err);
    res.status(500).json({ error: 'Failed to create registration' });
  }
});

// Update registration (e.g. update status)
registrationsRouter.patch('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('event_registrations')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Registration not found' });

    res.json(data);
  } catch (err) {
    console.error('Error updating registration:', err);
    res.status(500).json({ error: 'Failed to update registration' });
  }
});

// Delete registration
registrationsRouter.delete('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('event_registrations')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting registration:', err);
    res.status(500).json({ error: 'Failed to delete registration' });
  }
});
