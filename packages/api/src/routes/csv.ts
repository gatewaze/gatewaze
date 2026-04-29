import multer from 'multer';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
// SERVICE-ROLE OK: admin CSV import/export; bulk operations across
// people, registrations, etc. need full table access. The bulk path
// will continue to use service-role even after tenancy_v2 — admins
// must be able to operate across all tenant rows they manage.
import { getSupabase } from '../lib/supabase.js';
import { Readable } from 'stream';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

export const csvRouter = labeledRouter('jwt');
csvRouter.use(requireJwt());

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
      .select('id, email, attributes, auth_user_id, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No people found' });
    }

    // Flatten attributes into top-level columns for CSV readability
    const flatRows = data.map((row: any) => {
      const attrs = row.attributes || {};
      return {
        id: row.id,
        email: row.email,
        first_name: attrs.first_name || '',
        last_name: attrs.last_name || '',
        company: attrs.company || '',
        job_title: attrs.job_title || '',
        phone: attrs.phone || '',
        linkedin_url: attrs.linkedin_url || '',
        city: attrs.city || '',
        country: attrs.country || '',
        auth_user_id: row.auth_user_id || '',
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    const columns = Object.keys(flatRows[0]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="people.csv"');

    const stringifier = stringify({ header: true, columns });
    stringifier.pipe(res);

    for (const row of flatRows) {
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

function normalizePersonRecord(record: Record<string, string>): Record<string, unknown> {
  // Fields that stay as top-level columns
  const topLevelFields: Record<string, string> = {
    email: 'email',
    email_address: 'email',
  };

  // Fields that go into the attributes JSONB column
  const attributeFields: Record<string, string> = {
    first_name: 'first_name',
    firstname: 'first_name',
    first: 'first_name',
    last_name: 'last_name',
    lastname: 'last_name',
    last: 'last_name',
    company: 'company',
    organization: 'company',
    phone: 'phone',
    phone_number: 'phone',
    title: 'job_title',
    job_title: 'job_title',
  };

  const normalized: Record<string, unknown> = {};
  const attributes: Record<string, string> = {};

  for (const [csvKey, value] of Object.entries(record)) {
    const key = csvKey.toLowerCase().trim();
    if (value === '') continue;

    if (topLevelFields[key]) {
      normalized[topLevelFields[key]] = value;
    } else if (attributeFields[key]) {
      attributes[attributeFields[key]] = value;
    } else {
      // Unknown fields go into attributes
      attributes[key] = value;
    }
  }

  if (!normalized.email) {
    throw new Error('Missing required field: email');
  }

  if (Object.keys(attributes).length > 0) {
    normalized.attributes = attributes;
  }

  return normalized;
}
