/**
 * Avatar API Routes
 *
 * Handles avatar extraction from LinkedIn (via Puppeteer) and Gravatar.
 * Puppeteer is dynamically imported and optional.
 */

import { type Request, type Response } from 'express';
import crypto from 'crypto';
// User-scoped Supabase per spec §5.1. Storage policies + people RLS
// (both v1 admin/self and v2 account-scoped) gate what the route can
// do; the route itself doesn't need service-role escalation.
import { getRequestSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

const AVATAR_BUCKET = 'media';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const avatarsRouter = labeledRouter('jwt');
avatarsRouter.use(requireJwt());

function getGravatarUrl(email: string, size = 200): string {
  const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}

async function checkGravatarExists(email: string): Promise<boolean> {
  try {
    const response = await fetch(getGravatarUrl(email), { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

async function downloadAndStoreImage(
  req: Request,
  customerId: string,
  imageUrl: string,
  source: string,
) {
  const supabase = getRequestSupabase(req);

  const response = await fetch(imageUrl);
  if (!response.ok) return { success: false, error: 'Failed to download image' };

  const blob = await response.blob();
  if (blob.size > MAX_FILE_SIZE) {
    return { success: false, error: `Image too large: ${blob.size} bytes` };
  }

  const fileExt = blob.type.split('/')[1] || 'jpg';
  const fileName = `${customerId}-${source}-${Date.now()}.${fileExt}`;
  const filePath = `customers/${fileName}`;

  const buffer = Buffer.from(await blob.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(filePath, buffer, {
      contentType: blob.type,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  const { error: updateError } = await supabase.rpc('people_update_avatar', {
    p_person_id: customerId,
    p_avatar_source: source,
    p_storage_path: filePath,
    p_linkedin_url: source === 'linkedin' ? imageUrl : null,
  });

  if (updateError) {
    await supabase.storage.from(AVATAR_BUCKET).remove([filePath]);
    return { success: false, error: `Database update failed: ${updateError.message}` };
  }

  return { success: true, path: filePath, source };
}

// Sync avatar for single customer (Gravatar only - LinkedIn requires Puppeteer)
avatarsRouter.post('/sync/:customerId', async (req: Request, res: Response) => {
  const { customerId } = req.params;

  try {
    const supabase = getRequestSupabase(req);
    const { data: customer, error } = await supabase
      .from('people')
      .select('*')
      .eq('id', customerId)
      .single();

    if (error || !customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (customer.avatar_source === 'uploaded') {
      return res.json({ skipped: true, reason: 'Has uploaded avatar' });
    }

    // Try Gravatar
    if (customer.email) {
      const hasGravatar = await checkGravatarExists(customer.email);
      if (hasGravatar) {
        const result = await downloadAndStoreImage(req, customerId as string, getGravatarUrl(customer.email), 'gravatar');
        if (result.success) {
          return res.json({ success: true, source: 'gravatar', path: result.path });
        }
      }
    }

    res.status(400).json({ success: false, error: 'No avatar found' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Batch sync avatars
avatarsRouter.post('/sync-batch', async (req: Request, res: Response) => {
  const { customerIds } = req.body;

  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return res.status(400).json({ error: 'customerIds array required' });
  }

  try {
    const supabase = getRequestSupabase(req);
    const { data: customers, error } = await supabase
      .from('people')
      .select('*')
      .in('id', customerIds);

    if (error) return res.status(500).json({ error: error.message });

    const results: any[] = [];

    for (const customer of customers || []) {
      if (customer.avatar_source === 'uploaded') {
        results.push({ customerId: customer.id, skipped: true, reason: 'Has uploaded avatar' });
        continue;
      }

      if (customer.email) {
        const hasGravatar = await checkGravatarExists(customer.email);
        if (hasGravatar) {
          const result = await downloadAndStoreImage(req, customer.id, getGravatarUrl(customer.email), 'gravatar');
          results.push({ customerId: customer.id, ...result });
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }
      }

      results.push({ customerId: customer.id, success: false, reason: 'No avatar found' });
    }

    const synced = results.filter(r => r.success).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;

    res.json({ total: (customers || []).length, synced, skipped, failed, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
