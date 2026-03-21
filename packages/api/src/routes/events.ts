import { Router } from 'express';
import { getSupabase } from '../lib/supabase.js';

export const eventsRouter = Router();

// Generate 6-character event ID (matches gatewaze-admin logic)
// 3-4 random lowercase letters + remaining digits, shuffled
async function generateEventId(): Promise<string> {
  const supabase = getSupabase();
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';

  // Fetch existing IDs to avoid collisions
  const { data: existingEvents } = await supabase
    .from('events')
    .select('event_id');
  const existingIds = new Set(existingEvents?.map((e: { event_id: string }) => e.event_id) || []);

  let id: string;
  do {
    id = '';
    const letterCount = 3 + Math.floor(Math.random() * 2); // 3 or 4 letters
    for (let i = 0; i < letterCount; i++) {
      id += letters[Math.floor(Math.random() * letters.length)];
    }
    const remainingChars = 6 - letterCount;
    for (let i = 0; i < remainingChars; i++) {
      id += numbers[Math.floor(Math.random() * numbers.length)];
    }
    // Shuffle the characters
    id = id.split('').sort(() => Math.random() - 0.5).join('');
  } while (existingIds.has(id));

  return id;
}

// List events
eventsRouter.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const search = req.query.search as string;

    let query = supabase
      .from('events')
      .select('*', { count: 'exact' })
      .order('event_start', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) query = query.ilike('event_title', `%${search}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data, total: count, page, limit });
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get single event
eventsRouter.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Event not found' });

    res.json(data);
  } catch (err) {
    console.error('Error fetching event:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Create event
eventsRouter.post('/', async (req, res) => {
  try {
    const supabase = getSupabase();

    // Generate event_id if not provided (matches gatewaze-admin pattern)
    const body = { ...req.body };
    if (!body.event_id) {
      body.event_id = await generateEventId();
    }

    const { data, error } = await supabase
      .from('events')
      .insert(body)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update event
eventsRouter.patch('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('events')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error updating event:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete event
eventsRouter.delete('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});
