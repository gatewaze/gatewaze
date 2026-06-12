// Admin navigation-layout endpoints. Two layers, both holding a NavLayout:
//   - org-wide:  platform_settings key 'admin_nav_layout' (super_admin-writable)
//   - per-user:  admin_ui_preferences.nav_layout (owner-writable, RLS-scoped)
//
// The org write is gated to super_admin *here*, not by RLS: platform_settings'
// RLS permits any is_admin() write, which is broader than this feature wants,
// so the gate lives in the handler and the write uses the service-role client.
import {
  getRequestSupabase,
  getServiceSupabase,
} from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';
import { logger } from '../lib/logger.js';
import {
  sanitizeNavLayout,
  NavLayoutValidationError,
} from '@gatewaze/shared/sanitisers';
import type { NavLayout } from '@gatewaze/shared/modules';

export const adminNavLayoutRouter = labeledRouter('jwt');
adminNavLayoutRouter.use(requireJwt());

const ORG_NAV_LAYOUT_KEY = 'admin_nav_layout';

/** Parse a stored org layout (JSON string) into a NavLayout, or null. */
function parseStoredLayout(value: unknown): NavLayout | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return sanitizeNavLayout(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Pull the layout payload off a request body, distinguishing "reset" (null). */
function readLayoutPayload(body: unknown): { reset: boolean; layout?: NavLayout } {
  const raw = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}).layout;
  if (raw === null) return { reset: true };
  return { reset: false, layout: sanitizeNavLayout(raw) };
}

/** True when the calling user holds the super_admin role. */
async function isCallerSuperAdmin(userId: string): Promise<boolean> {
  // SERVICE-ROLE OK: reading the caller's own platform role for an
  // authorization gate, before any privileged write.
  const { data } = await getServiceSupabase()
    .from('admin_profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle<{ role: string }>();
  return data?.role === 'super_admin';
}

// ── Org-wide layout ────────────────────────────────────────────────────────

adminNavLayoutRouter.get('/org', async (req, res) => {
  try {
    const { data, error } = await getRequestSupabase(req)
      .from('platform_settings')
      .select('value')
      .eq('key', ORG_NAV_LAYOUT_KEY)
      .maybeSingle<{ value: string }>();
    if (error) throw error;
    res.json({ layout: parseStoredLayout(data?.value) });
  } catch (err) {
    logger.error({ err }, '[admin-nav-layout] org read failed');
    res.status(500).json({ error: 'Failed to load org navigation layout' });
  }
});

adminNavLayoutRouter.put('/org', async (req, res) => {
  try {
    if (!(await isCallerSuperAdmin(req.userId!))) {
      return res
        .status(403)
        .json({ error: 'Only a super_admin can change the organization navigation layout' });
    }

    let payload: { reset: boolean; layout?: NavLayout };
    try {
      payload = readLayoutPayload(req.body);
    } catch (err) {
      if (err instanceof NavLayoutValidationError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    // SERVICE-ROLE OK: super_admin verified above; org settings are
    // platform-wide and have no per-row owner.
    const supabase = getServiceSupabase();

    if (payload.reset) {
      const { error } = await supabase
        .from('platform_settings')
        .delete()
        .eq('key', ORG_NAV_LAYOUT_KEY);
      if (error) throw error;
      return res.json({ layout: null });
    }

    const { error } = await supabase
      .from('platform_settings')
      .upsert(
        { key: ORG_NAV_LAYOUT_KEY, value: JSON.stringify(payload.layout) },
        { onConflict: 'key' },
      );
    if (error) throw error;
    res.json({ layout: payload.layout });
  } catch (err) {
    logger.error({ err }, '[admin-nav-layout] org write failed');
    res.status(500).json({ error: 'Failed to save org navigation layout' });
  }
});

// ── Per-user layout ────────────────────────────────────────────────────────

adminNavLayoutRouter.get('/me', async (req, res) => {
  try {
    const { data, error } = await getRequestSupabase(req)
      .from('admin_ui_preferences')
      .select('nav_layout')
      .maybeSingle<{ nav_layout: NavLayout | null }>();
    if (error) throw error;
    const layout = data?.nav_layout ? sanitizeNavLayout(data.nav_layout) : null;
    res.json({ layout });
  } catch (err) {
    logger.error({ err }, '[admin-nav-layout] personal read failed');
    res.status(500).json({ error: 'Failed to load personal navigation layout' });
  }
});

adminNavLayoutRouter.put('/me', async (req, res) => {
  try {
    let payload: { reset: boolean; layout?: NavLayout };
    try {
      payload = readLayoutPayload(req.body);
    } catch (err) {
      if (err instanceof NavLayoutValidationError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    // User-scoped: RLS (user_id = auth.uid()) ensures a caller can only write
    // their own row, so user_id is set from the verified token, not the body.
    const { error } = await getRequestSupabase(req)
      .from('admin_ui_preferences')
      .upsert(
        { user_id: req.userId!, nav_layout: payload.reset ? null : payload.layout },
        { onConflict: 'user_id' },
      );
    if (error) throw error;
    res.json({ layout: payload.reset ? null : payload.layout });
  } catch (err) {
    logger.error({ err }, '[admin-nav-layout] personal write failed');
    res.status(500).json({ error: 'Failed to save personal navigation layout' });
  }
});
