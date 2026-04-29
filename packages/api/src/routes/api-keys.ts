// SERVICE-ROLE OK: api_keys is a service-role-only table by RLS
// (00025_silent_table_policies.sql). Admin CRUD on api keys runs
// here with service-role; requireJwt() guards the route, and the
// admin status check belongs in the route handler (phase-3 service
// token work adds super_admin gating where needed).
import { getSupabase } from '../lib/supabase.js';
import { generateApiKey } from '../lib/api-key-utils.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

export const apiKeysRouter = labeledRouter('jwt');
apiKeysRouter.use(requireJwt());

/** Transform snake_case DB row to camelCase response (omitting key_hash). */
function toApiKey(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    rateLimitRpm: row.rate_limit_rpm,
    writeRateLimitRpm: row.write_rate_limit_rpm,
    isActive: row.is_active,
    expiresAt: row.expires_at,
    metadata: row.metadata,
    lastUsedAt: row.last_used_at,
    totalRequests: row.total_requests,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Create API key
apiKeysRouter.post('/', async (req, res) => {
  try {
    const { name, scopes, rateLimitRpm, writeRateLimitRpm, expiresAt, metadata } = req.body;

    // Validate name
    if (!name || typeof name !== 'string' || name.length < 1 || name.length > 200) {
      return res.status(400).json({ error: 'name is required and must be 1-200 characters' });
    }

    // Validate scopes
    if (scopes !== undefined && !Array.isArray(scopes)) {
      return res.status(400).json({ error: 'scopes must be a string array' });
    }

    // Validate rateLimitRpm
    const rpm = rateLimitRpm ?? 60;
    if (typeof rpm !== 'number' || rpm < 1 || rpm > 10000) {
      return res.status(400).json({ error: 'rateLimitRpm must be between 1 and 10000' });
    }

    // Validate writeRateLimitRpm
    const writeRpm = writeRateLimitRpm ?? 10;
    if (typeof writeRpm !== 'number' || writeRpm < 1 || writeRpm > 10000) {
      return res.status(400).json({ error: 'writeRateLimitRpm must be between 1 and 10000' });
    }

    // Validate expiresAt
    if (expiresAt !== undefined) {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'expiresAt must be a valid ISO date' });
      }
    }

    const { raw, hash, prefix } = generateApiKey();

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        name,
        key_hash: hash,
        key_prefix: prefix,
        scopes: scopes ?? [],
        rate_limit_rpm: rpm,
        write_rate_limit_rpm: writeRpm,
        expires_at: expiresAt ?? null,
        metadata: metadata ?? {},
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      data: {
        apiKey: raw,
        key: toApiKey(data),
      },
    });
  } catch (err) {
    console.error('Error creating API key:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// List API keys (paginated)
apiKeysRouter.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const active = req.query.active as string | undefined;

    const supabase = getSupabase();

    let query = supabase
      .from('api_keys')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (active === 'true') query = query.eq('is_active', true);
    else if (active === 'false') query = query.eq('is_active', false);

    const { data, error, count } = await query;
    if (error) throw error;

    const total = count ?? 0;

    res.json({
      data: (data ?? []).map((row: Record<string, unknown>) => toApiKey(row)),
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('Error listing API keys:', err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// List available scopes (placeholder)
apiKeysRouter.get('/scopes', async (_req, res) => {
  res.json({ data: [] });
});

// Get key details
apiKeysRouter.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'API key not found' });

    res.json({ data: toApiKey(data) });
  } catch (err) {
    console.error('Error fetching API key:', err);
    res.status(500).json({ error: 'Failed to fetch API key' });
  }
});

// Update key
apiKeysRouter.patch('/:id', async (req, res) => {
  try {
    const { name, scopes, rateLimitRpm, writeRateLimitRpm, isActive, expiresAt, metadata } =
      req.body;

    // Validate name if provided
    if (name !== undefined && (typeof name !== 'string' || name.length < 1 || name.length > 200)) {
      return res.status(400).json({ error: 'name must be 1-200 characters' });
    }

    if (scopes !== undefined && !Array.isArray(scopes)) {
      return res.status(400).json({ error: 'scopes must be a string array' });
    }

    if (rateLimitRpm !== undefined && (typeof rateLimitRpm !== 'number' || rateLimitRpm < 1 || rateLimitRpm > 10000)) {
      return res.status(400).json({ error: 'rateLimitRpm must be between 1 and 10000' });
    }

    if (writeRateLimitRpm !== undefined && (typeof writeRateLimitRpm !== 'number' || writeRateLimitRpm < 1 || writeRateLimitRpm > 10000)) {
      return res.status(400).json({ error: 'writeRateLimitRpm must be between 1 and 10000' });
    }

    if (expiresAt !== undefined && expiresAt !== null) {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'expiresAt must be a valid ISO date' });
      }
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (scopes !== undefined) updates.scopes = scopes;
    if (rateLimitRpm !== undefined) updates.rate_limit_rpm = rateLimitRpm;
    if (writeRateLimitRpm !== undefined) updates.write_rate_limit_rpm = writeRateLimitRpm;
    if (expiresAt !== undefined) updates.expires_at = expiresAt;
    if (metadata !== undefined) updates.metadata = metadata;

    if (isActive !== undefined) {
      updates.is_active = isActive;
      if (isActive === false) {
        updates.revoked_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('api_keys')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'API key not found' });

    res.json({ data: toApiKey(data) });
  } catch (err) {
    console.error('Error updating API key:', err);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// Revoke key
apiKeysRouter.delete('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('api_keys')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error('Error revoking API key:', err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Usage stats
apiKeysRouter.get('/:id/usage', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('api_keys')
      .select('total_requests, last_used_at')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'API key not found' });

    res.json({
      data: {
        totalRequests: data.total_requests,
        lastUsedAt: data.last_used_at,
      },
    });
  } catch (err) {
    console.error('Error fetching API key usage:', err);
    res.status(500).json({ error: 'Failed to fetch API key usage' });
  }
});
