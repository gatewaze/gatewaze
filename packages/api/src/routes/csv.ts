import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { getSupabase } from '../lib/supabase.js';
import { Readable } from 'stream';

export const csvRouter = Router();

// Configure multer for in-memory file uploads (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// ── Import Events ──────────────────────────────────────────────────────────────

csvRouter.post('/import/events', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file provided' });
    }

    const records = await parseCsvBuffer(req.file.buffer);

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    const supabase = getSupabase();
    const batchSize = 100;
    let inserted = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize).map((record, idx) => {
        try {
          return normalizeEventRecord(record);
        } catch (err) {
          errors.push({
            row: i + idx + 2, // +2 for header row and 1-based indexing
            error: err instanceof Error ? err.message : 'Invalid record',
          });
          return null;
        }
      }).filter(Boolean);

      if (batch.length > 0) {
        const { error, count } = await supabase
          .from('events')
          .insert(batch)
          .select('id');

        if (error) {
          errors.push({
            row: i + 2,
            error: `Batch insert failed: ${error.message}`,
          });
        } else {
          inserted += count ?? batch.length;
        }
      }
    }

    res.json({
      imported: inserted,
      total: records.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Error importing events CSV:', err);
    res.status(500).json({ error: 'Failed to import events' });
  }
});

// ── Export Events ──────────────────────────────────────────────────────────────

csvRouter.get('/export/events', async (req, res) => {
  try {
    const supabase = getSupabase();
    const status = req.query.status as string;

    let query = supabase
      .from('events')
      .select('*')
      .order('event_start', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No events found' });
    }

    const columns = Object.keys(data[0]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');

    const stringifier = stringify({ header: true, columns });
    stringifier.pipe(res);

    for (const row of data) {
      stringifier.write(row);
    }

    stringifier.end();
  } catch (err) {
    console.error('Error exporting events CSV:', err);
    res.status(500).json({ error: 'Failed to export events' });
  }
});

// ── Import People ──────────────────────────────────────────────────────────────

csvRouter.post('/import/people', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file provided' });
    }

    const records = await parseCsvBuffer(req.file.buffer);

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    const supabase = getSupabase();
    const batchSize = 100;
    let inserted = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize).map((record, idx) => {
        try {
          return normalizePersonRecord(record);
        } catch (err) {
          errors.push({
            row: i + idx + 2,
            error: err instanceof Error ? err.message : 'Invalid record',
          });
          return null;
        }
      }).filter(Boolean);

      if (batch.length > 0) {
        const { error, count } = await supabase
          .from('people')
          .insert(batch)
          .select('id');

        if (error) {
          errors.push({
            row: i + 2,
            error: `Batch insert failed: ${error.message}`,
          });
        } else {
          inserted += count ?? batch.length;
        }
      }
    }

    res.json({
      imported: inserted,
      total: records.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Error importing people CSV:', err);
    res.status(500).json({ error: 'Failed to import people' });
  }
});

// ── Export People ──────────────────────────────────────────────────────────────

csvRouter.get('/export/people', async (req, res) => {
  try {
    const supabase = getSupabase();
    const status = req.query.status as string;

    let query = supabase
      .from('people')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No people found' });
    }

    const columns = Object.keys(data[0]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="people.csv"');

    const stringifier = stringify({ header: true, columns });
    stringifier.pipe(res);

    for (const row of data) {
      stringifier.write(row);
    }

    stringifier.end();
  } catch (err) {
    console.error('Error exporting people CSV:', err);
    res.status(500).json({ error: 'Failed to export people' });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseCsvBuffer(buffer: Buffer): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const records: Record<string, string>[] = [];
    const stream = Readable.from(buffer);

    stream
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
        })
      )
      .on('data', (record: Record<string, string>) => records.push(record))
      .on('end', () => resolve(records))
      .on('error', (err: Error) => reject(err));
  });
}

function normalizeEventRecord(record: Record<string, string>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  // Map common CSV column names to database columns
  const fieldMap: Record<string, string> = {
    title: 'event_title',
    name: 'event_title',
    event_name: 'event_title',
    event_title: 'event_title',
    description: 'event_description',
    event_description: 'event_description',
    start_date: 'event_start',
    start: 'event_start',
    event_start: 'event_start',
    end_date: 'event_end',
    end: 'event_end',
    event_end: 'event_end',
    location: 'event_location',
    location_name: 'event_location',
    event_location: 'event_location',
    venue: 'event_location',
    status: 'status',
    url: 'url',
    image_url: 'event_logo',
    event_logo: 'event_logo',
    event_id: 'event_id',
  };

  for (const [csvKey, value] of Object.entries(record)) {
    const dbKey = fieldMap[csvKey.toLowerCase().trim()] ?? csvKey.toLowerCase().trim();
    if (value !== '') {
      normalized[dbKey] = value;
    }
  }

  if (!normalized.event_title) {
    throw new Error('Missing required field: title');
  }

  return normalized;
}

function normalizePersonRecord(record: Record<string, string>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  const fieldMap: Record<string, string> = {
    first_name: 'first_name',
    firstname: 'first_name',
    first: 'first_name',
    last_name: 'last_name',
    lastname: 'last_name',
    last: 'last_name',
    email: 'email',
    email_address: 'email',
    company: 'company',
    organization: 'company',
    phone: 'phone',
    phone_number: 'phone',
    status: 'status',
    title: 'title',
    job_title: 'title',
  };

  for (const [csvKey, value] of Object.entries(record)) {
    const dbKey = fieldMap[csvKey.toLowerCase().trim()] ?? csvKey.toLowerCase().trim();
    if (value !== '') {
      normalized[dbKey] = value;
    }
  }

  if (!normalized.email) {
    throw new Error('Missing required field: email');
  }

  return normalized;
}
